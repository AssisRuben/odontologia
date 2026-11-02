import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { type ConnectionStatus, type WebhookEvent } from '@/lib/whatsapp'
import { fetchAll } from './cycleData'
import { normalizePhone } from './phone'
import { parseReply, pickConfirmationTarget, type SentConfirmation } from './replies'
import { createSupabaseQueueRepo } from './repo'
import { sendNow } from './sendNow'
import { renderTemplate } from './templates'
import { formatDataCurta, formatHora } from './time'
import { normalizeMessagingConfig } from './config'
import type { MessagingConfig } from './types'
import { startOfClinicDay } from './window'

const CONFIRMATION_WINDOW_MS = 48 * 3_600_000
const CONFIRM_TEMPLATE = 'Consulta confirmada! Até {data} às {hora}.'
const CANCEL_TEXT = 'Consulta desmarcada. Em breve entraremos em contato para remarcar.'

export interface IncomingDeps {
  findClinicByInstance(instance: string): Promise<{ clinicId: string; token: string; cfg: MessagingConfig } | null>
  findPatientByPhone(clinicId: string, phone: string): Promise<string | null>
  /** Evolution pode entregar a mesma mensagem duas vezes: já existe uma com este provider_message_id? */
  incomingExists(clinicId: string, providerMessageId: string): Promise<boolean>
  saveIncoming(row: { clinic_id: string; patient_id: string | null; phone: string; body: string; provider_message_id: string }): Promise<string | null>
  recentConfirmations(clinicId: string, phone: string, since: Date): Promise<SentConfirmation[]>
  /** false se a consulta não é mais agendada/confirmada (ou não é da clínica): nada foi alterado. */
  setAppointmentStatus(clinicId: string, appointmentId: string, status: 'confirmed' | 'cancelled'): Promise<boolean>
  setReplyAction(messageId: string, action: 'confirmed' | 'cancelled', appointmentId: string): Promise<void>
  sendAutoReply(args: { clinicId: string; patientId: string | null; phone: string; body: string; appointmentId: string }): Promise<void>
  updateConnection(instance: string, status: ConnectionStatus, phone: string | null): Promise<void>
}

export async function handleIncoming(
  event: WebhookEvent,
  deps: IncomingDeps,
  now: Date,
): Promise<'ignored' | 'stored' | 'confirmed' | 'cancelled' | 'connection'> {
  if (event.kind === 'connection') {
    await deps.updateConnection(event.instance, event.status, event.phone)
    return 'connection'
  }

  const clinic = await deps.findClinicByInstance(event.instance)
  if (!clinic) return 'ignored'
  const { clinicId, cfg } = clinic

  if (await deps.incomingExists(clinicId, event.providerMessageId)) return 'ignored'

  const phone = normalizePhone(event.from) ?? event.from
  const patientId = await deps.findPatientByPhone(clinicId, phone)
  // null = duplicata concorrente (índice único)
  const messageId = await deps.saveIncoming({
    clinic_id: clinicId,
    patient_id: patientId,
    phone,
    body: event.text,
    provider_message_id: event.providerMessageId,
  })

  if (messageId === null) return 'ignored'

  const reply = parseReply(event.text)
  if (!reply) return 'stored'

  const since = new Date(now.getTime() - CONFIRMATION_WINDOW_MS)
  const target = pickConfirmationTarget(await deps.recentConfirmations(clinicId, phone, since), now)
  if (!target) return 'stored'

  const action = reply === 'confirm' ? 'confirmed' : 'cancelled'
  // "1"/"2" repetido: a consulta já está nesse status — só guarda a mensagem, sem nova resposta automática.
  if (target.appointment.status === action) return 'stored'
  if (!(await deps.setAppointmentStatus(clinicId, target.appointment_id, action))) return 'stored'
  await deps.setReplyAction(messageId, action, target.appointment_id)

  let body = CANCEL_TEXT
  if (action === 'confirmed') {
    const start = new Date(target.appointment.start_time)
    body = renderTemplate(CONFIRM_TEMPLATE, {
      paciente: '',
      paciente_completo: '',
      clinica: '',
      data: formatDataCurta(start, cfg.timezone),
      hora: formatHora(start, cfg.timezone),
    })
  }
  // A resposta automática não pode desfazer a mudança de status nem derrubar o webhook.
  try {
    await deps.sendAutoReply({ clinicId, patientId, phone, body, appointmentId: target.appointment_id })
  } catch (err) {
    console.error('[webhook] auto_reply falhou:', err instanceof Error ? err.message : 'erro')
  }
  return action
}

export interface PatientPhones {
  id: string
  whatsapp: string | null
  phone: string | null
  created_at: string
}

/** Escolhe o paciente do telefone; em empate, o da confirmação enviada mais recente, senão o mais antigo. */
export function findPatientByPhoneIn(
  patients: PatientPhones[],
  phone: string,
  lastConfirmationByPatient: Map<string, string>,
): string | null {
  const target = normalizePhone(phone)
  if (!target) return null
  const matches = patients.filter((p) => (normalizePhone(p.whatsapp) ?? normalizePhone(p.phone)) === target)
  if (matches.length === 0) return null
  const sorted = [...matches].sort((a, b) => {
    const ca = lastConfirmationByPatient.get(a.id)
    const cb = lastConfirmationByPatient.get(b.id)
    if (ca && cb && ca !== cb) return new Date(cb).getTime() - new Date(ca).getTime()
    if (ca && !cb) return -1
    if (!ca && cb) return 1
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  })
  return sorted[0].id
}

function check(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

export function createSupabaseIncomingDeps(admin: SupabaseClient = createAdminClient()): IncomingDeps {
  const repo = createSupabaseQueueRepo(admin)
  return {
    async findClinicByInstance(instance) {
      const { data: conn, error } = await admin
        .from('whatsapp_connections')
        .select('clinic_id, token')
        .eq('instance', instance)
        .maybeSingle()
      check(error)
      if (!conn) return null
      const { data: clinic, error: cErr } = await admin
        .from('clinics')
        .select('messaging_config')
        .eq('id', conn.clinic_id)
        .single()
      check(cErr)
      return { clinicId: conn.clinic_id, token: conn.token, cfg: normalizeMessagingConfig(clinic!.messaging_config) }
    },

    async findPatientByPhone(clinicId, phone) {
      const target = normalizePhone(phone)
      if (!target) return null
      const patients = await fetchAll<PatientPhones>((a, b) =>
        admin
          .from('patients')
          .select('id, whatsapp, phone, created_at')
          .eq('clinic_id', clinicId)
          .order('created_at')
          .order('id')
          .range(a, b),
      )
      const matching = patients.filter((p) => (normalizePhone(p.whatsapp) ?? normalizePhone(p.phone)) === target)
      const last = new Map<string, string>()
      if (matching.length > 1) {
        const { data, error } = await admin
          .from('messages')
          .select('patient_id, sent_at')
          .eq('clinic_id', clinicId)
          .eq('type', 'confirmation')
          .eq('direction', 'out')
          .eq('status', 'sent')
          .eq('phone', target)
          .in('patient_id', matching.map((p) => p.id))
        check(error)
        for (const r of (data ?? []) as { patient_id: string; sent_at: string }[]) {
          const cur = last.get(r.patient_id)
          if (!cur || r.sent_at > cur) last.set(r.patient_id, r.sent_at)
        }
      }
      return findPatientByPhoneIn(matching, target, last)
    },

    async incomingExists(clinicId, providerMessageId) {
      const { data, error } = await admin
        .from('messages')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('provider_message_id', providerMessageId)
        .limit(1)
      check(error)
      return (data?.length ?? 0) > 0
    },

    async saveIncoming(row) {
      const { data, error } = await admin
        .from('messages')
        .insert({ ...row, type: 'incoming', direction: 'in', status: 'received' })
        .select('id')
        .single()
      if (error?.code === '23505') return null
      check(error)
      return data!.id as string
    },

    async recentConfirmations(clinicId, phone, since) {
      const { data, error } = await admin
        .from('messages')
        .select('id, appointment_id, sent_at, dedupe_key, appointments(start_time, status)')
        .eq('clinic_id', clinicId)
        .eq('type', 'confirmation')
        .eq('direction', 'out')
        .eq('status', 'sent')
        .eq('phone', phone)
        .gte('sent_at', since.toISOString())
        .not('appointment_id', 'is', null)
        .not('dedupe_key', 'is', null)
      check(error)
      type Appt = { start_time: string; status: string }
      type Raw = {
        id: string
        appointment_id: string
        sent_at: string
        dedupe_key: string
        appointments: Appt | Appt[] | null
      }
      const out: SentConfirmation[] = []
      for (const r of (data ?? []) as unknown as Raw[]) {
        const appt = Array.isArray(r.appointments) ? r.appointments[0] : r.appointments
        if (!appt) continue
        out.push({
          message_id: r.id,
          appointment_id: r.appointment_id,
          sent_at: r.sent_at,
          dedupe_key: r.dedupe_key,
          appointment: { start_time: appt.start_time, status: appt.status },
        })
      }
      return out
    },

    async setAppointmentStatus(clinicId, appointmentId, status) {
      const { data, error } = await admin
        .from('appointments')
        .update({ status })
        .eq('id', appointmentId)
        .eq('clinic_id', clinicId)
        .in('status', ['scheduled', 'confirmed'])
        .select('id')
      check(error)
      return (data?.length ?? 0) === 1
    },

    async setReplyAction(messageId, action, appointmentId) {
      const { error } = await admin
        .from('messages')
        .update({ reply_action: action, appointment_id: appointmentId })
        .eq('id', messageId)
      check(error)
    },

    async sendAutoReply({ clinicId, patientId, phone, body, appointmentId }) {
      const { data: conn, error: connErr } = await admin
        .from('whatsapp_connections')
        .select('instance, token')
        .eq('clinic_id', clinicId)
        .maybeSingle()
      check(connErr)
      const { data: clinic, error: cErr } = await admin
        .from('clinics')
        .select('messaging_config')
        .eq('id', clinicId)
        .single()
      check(cErr)
      const cfg = normalizeMessagingConfig(clinic!.messaging_config)
      const base = { clinic_id: clinicId, patient_id: patientId, appointment_id: appointmentId, type: 'auto_reply', direction: 'out', phone, body }

      const sentToday = await repo.countSentSince(clinicId, startOfClinicDay(new Date(), cfg.timezone))
      if (sentToday >= cfg.daily_limit || !conn) {
        const { error } = await admin
          .from('messages')
          .insert({ ...base, status: 'failed', error: !conn ? 'sem_conexao' : 'daily_limit' })
        check(error)
        return
      }

      await sendNow(admin, conn, { ...base })
    },

    async updateConnection(instance, status, phone) {
      const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
      if (status === 'connected') update.ever_connected = true
      if (phone) update.phone = phone
      const { error } = await admin.from('whatsapp_connections').update(update).eq('instance', instance)
      check(error)
    },
  }
}
