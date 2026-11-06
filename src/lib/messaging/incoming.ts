import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProvider, type ConnectionStatus, type WebhookEvent } from '@/lib/whatsapp'
import { fetchAll } from './cycleData'
import { normalizePhone } from './phone'
import { parseReply, pickConfirmationTarget, type SentConfirmation } from './replies'
import { createSupabaseQueueRepo } from './repo'
import { sendNow } from './sendNow'
import { renderTemplate } from './templates'
import { formatDataCurta, formatHora } from './time'
import { normalizeMessagingConfig } from './config'
import { normalizeAgentConfig } from '@/lib/agente/config'
import {
  GREETING_WINDOW_MS,
  MAX_WA_AUDIO_SECONDS,
  OUTGOING_RECHECK_MS,
  REASON_CLINIC_PHONE,
  TEXT_AUDIO,
  TEXT_AUDIO_UNTRANSCRIBED,
  truncateIncoming,
} from '@/lib/agente/conversa'
import { upsertConversation } from '@/lib/agente/repo'
import { getAiForClinic } from '@/lib/ia/conexao'
import { TRANSCRIBE_MODEL, WA_AI_OPTIONS } from '@/lib/ia/modelos'
import { createAiDeps, recordUsage } from '@/lib/ia/repo'
import type { MessagingConfig } from './types'
import { startOfClinicDay } from './window'

const CONFIRMATION_WINDOW_MS = 48 * 3_600_000
const CONFIRM_TEMPLATE = 'Consulta confirmada! Até {data} às {hora}.'
const CANCEL_TEXT = 'Consulta desmarcada. Em breve entraremos em contato para remarcar.'

export type IncomingResult = 'ignored' | 'stored' | 'confirmed' | 'cancelled' | 'connection' | 'outgoing'
export interface IncomingOutcome {
  result: IncomingResult
  agent: { conversationId: string; messageId: string } | null
}

export interface IncomingDeps {
  findClinicByInstance(instance: string): Promise<{ clinicId: string; token: string; cfg: MessagingConfig } | null>
  findPatientByPhone(clinicId: string, phone: string): Promise<string | null>
  /** Evolution pode entregar a mesma mensagem duas vezes: já existe uma com este provider_message_id? */
  incomingExists(clinicId: string, providerMessageId: string): Promise<boolean>
  saveIncoming(row: {
    clinic_id: string
    patient_id: string | null
    phone: string
    body: string
    provider_message_id: string
    conversation_id: string
    transcribed: boolean
  }): Promise<string | null>
  recentConfirmations(clinicId: string, phone: string, since: Date): Promise<SentConfirmation[]>
  /** false se a consulta não é mais agendada/confirmada (ou não é da clínica): nada foi alterado. */
  setAppointmentStatus(clinicId: string, appointmentId: string, status: 'confirmed' | 'cancelled'): Promise<boolean>
  setReplyAction(messageId: string, action: 'confirmed' | 'cancelled', appointmentId: string): Promise<void>
  sendAutoReply(args: { clinicId: string; patientId: string | null; phone: string; body: string; appointmentId: string }): Promise<void>
  updateConnection(instance: string, status: ConnectionStatus, phone: string | null): Promise<void>
  agentEnabled(clinicId: string): Promise<boolean>
  /** Baixa e transcreve o áudio; registra o uso `transcricao_whatsapp`. */
  transcribeAudio(
    clinicId: string,
    instance: string,
    token: string,
    providerMessageId: string,
    seconds: number,
  ): Promise<{ ok: true; text: string } | { ok: false; reason: 'no_key' | 'failed' }>
  upsertConversation(clinicId: string, phone: string, patientId: string | null, at: Date): Promise<string>
  /** O id já está em `messages`, ou há linha `out` com mesmo telefone e corpo que está `sending` (qualquer idade) ou foi enviada depois de `since`. */
  outgoingKnown(clinicId: string, providerMessageId: string, phone: string, body: string, since: Date): Promise<boolean>
  saveHumanFromPhone(clinicId: string, conversationId: string, phone: string, body: string, providerMessageId: string): Promise<void>
  setHandler(conversationId: string, handler: 'agent' | 'human', reason: string | null): Promise<void>
  markRead(conversationId: string): Promise<void>
  /** Quando chegou a última mensagem recebida deste telefone (null se nunca). */
  lastIncomingAt(clinicId: string, phone: string): Promise<Date | null>
  sleep(ms: number): Promise<void>
}

const OUTGOING_KNOWN_WINDOW_MS = 60_000

export async function handleIncoming(event: WebhookEvent, deps: IncomingDeps, now: Date): Promise<IncomingOutcome> {
  const done = (result: IncomingResult): IncomingOutcome => ({ result, agent: null })

  if (event.kind === 'connection') {
    await deps.updateConnection(event.instance, event.status, event.phone)
    return done('connection')
  }

  const clinic = await deps.findClinicByInstance(event.instance)
  if (!clinic) return done('ignored')
  const { clinicId, cfg } = clinic

  if (event.kind === 'outgoing') return handleOutgoing(event, clinicId, deps, now)

  if (await deps.incomingExists(clinicId, event.providerMessageId)) return done('ignored')

  const phone = normalizePhone(event.from) ?? event.from
  const patientId = await deps.findPatientByPhone(clinicId, phone)
  const agentOn = await deps.agentEnabled(clinicId)

  // Privacidade (LGPD): o número da clínica também recebe conversas que não são de pacientes.
  // Com o agente desligado, só guarda mensagens de pacientes cadastrados ou de quem recebeu uma
  // confirmação recente (cobre o telefone editado depois do envio). As demais nem chegam ao banco.
  // Com o agente ligado, qualquer número individual é guardado.
  const since = new Date(now.getTime() - CONFIRMATION_WINDOW_MS)
  let confirmations: SentConfirmation[] | null = null
  if (!patientId && !agentOn) {
    confirmations = await deps.recentConfirmations(clinicId, phone, since)
    if (confirmations.length === 0) return done('ignored')
  }

  let text = event.text
  let transcribed = false
  if (event.audio) {
    text = TEXT_AUDIO
    if (agentOn) {
      if (event.audio.seconds > MAX_WA_AUDIO_SECONDS) {
        text = TEXT_AUDIO_UNTRANSCRIBED
      } else {
        const t = await deps.transcribeAudio(clinicId, event.instance, clinic.token, event.providerMessageId, event.audio.seconds)
        if (t.ok) {
          text = t.text
          transcribed = true
        } else if (t.reason === 'failed') {
          text = TEXT_AUDIO_UNTRANSCRIBED
        }
      }
    }
  }
  text = truncateIncoming(text)

  const conversationId = await deps.upsertConversation(clinicId, phone, patientId, event.at)
  // null = duplicata concorrente (índice único)
  const messageId = await deps.saveIncoming({
    clinic_id: clinicId,
    patient_id: patientId,
    phone,
    body: text,
    provider_message_id: event.providerMessageId,
    conversation_id: conversationId,
    transcribed,
  })

  if (messageId === null) return done('ignored')

  // Mensagem guardada e não consumida por "1"/"2": segue para o agente (se ligado).
  const toAgent: IncomingOutcome = { result: 'stored', agent: agentOn ? { conversationId, messageId } : null }

  const reply = parseReply(text)
  if (!reply) return toAgent

  confirmations ??= await deps.recentConfirmations(clinicId, phone, since)
  const target = pickConfirmationTarget(confirmations, now)
  if (!target) return toAgent

  const action = reply === 'confirm' ? 'confirmed' : 'cancelled'
  // "1"/"2" repetido: a consulta já está nesse status — só guarda a mensagem, sem nova resposta automática.
  if (target.appointment.status === action) return toAgent
  if (!(await deps.setAppointmentStatus(clinicId, target.appointment_id, action))) return toAgent
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
  return done(action)
}

async function handleOutgoing(
  event: Extract<WebhookEvent, { kind: 'outgoing' }>,
  clinicId: string,
  deps: IncomingDeps,
  now: Date,
): Promise<IncomingOutcome> {
  const ignored: IncomingOutcome = { result: 'ignored', agent: null }
  const phone = normalizePhone(event.to) ?? event.to
  const patientId = await deps.findPatientByPhone(clinicId, phone)
  // Mesma regra de privacidade: sem agente, conversas da clínica com quem não é paciente não são guardadas.
  if (!patientId && !(await deps.agentEnabled(clinicId))) return ignored

  const since = new Date(now.getTime() - OUTGOING_KNOWN_WINDOW_MS)
  if (await deps.outgoingKnown(clinicId, event.providerMessageId, phone, event.text, since)) return ignored
  // O app pode ainda não ter gravado o id da mensagem que acabou de enviar.
  await deps.sleep(OUTGOING_RECHECK_MS)
  if (await deps.outgoingKnown(clinicId, event.providerMessageId, phone, event.text, since)) return ignored

  const conversationId = await deps.upsertConversation(clinicId, phone, patientId, event.at)
  await deps.saveHumanFromPhone(clinicId, conversationId, phone, truncateIncoming(event.text), event.providerMessageId)
  // Saudação/ausência automática do WhatsApp Business sai logo após a mensagem do paciente:
  // fica no histórico, mas não tira a conversa do agente.
  const lastIn = await deps.lastIncomingAt(clinicId, phone)
  if (lastIn && Math.abs(event.at.getTime() - lastIn.getTime()) < GREETING_WINDOW_MS) return { result: 'outgoing', agent: null }
  await deps.setHandler(conversationId, 'human', REASON_CLINIC_PHONE)
  await deps.markRead(conversationId)
  return { result: 'outgoing', agent: null }
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
 
    async agentEnabled(clinicId) {
      const { data, error } = await admin.from('clinics').select('agent_config').eq('id', clinicId).single()
      check(error)
      return normalizeAgentConfig(data!.agent_config).enabled
    },

    async transcribeAudio(clinicId, instance, token, providerMessageId, seconds) {
      const ai = await getAiForClinic(clinicId, createAiDeps(admin, WA_AI_OPTIONS))
      if (!ai) return { ok: false, reason: 'no_key' }
      const uso = { kind: 'transcricao_whatsapp' as const, model: TRANSCRIBE_MODEL, audio_seconds: seconds, input_tokens: null, output_tokens: null }
      // Falha ao registrar o uso não pode descartar a transcrição nem derrubar o webhook.
      const record = async (ok: boolean) => {
        try {
          await recordUsage(admin, clinicId, null, { ...uso, ok })
        } catch (e) {
          console.error('[webhook] falha ao registrar uso:', e instanceof Error ? e.name : 'erro')
        }
      }
      try {
        const { bytes, mimetype } = await getProvider().getAudio(instance, token, providerMessageId)
        const type = mimetype.split(';')[0].trim() || 'audio/ogg'
        const ext = type.includes('mp4') || type.includes('m4a') ? 'm4a' : type.includes('mpeg') ? 'mp3' : type.includes('webm') ? 'webm' : 'ogg'
        const text = await ai.client.transcribe(new File([bytes as BlobPart], `audio.${ext}`, { type }))
        await record(true)
        return { ok: true, text }
      } catch (err) {
        console.error('[webhook] transcrição falhou:', err instanceof Error ? err.message : 'erro')
        await record(false)
        return { ok: false, reason: 'failed' }
      }
    },

    upsertConversation: (clinicId, phone, patientId, at) => upsertConversation(admin, clinicId, phone, patientId, at),

    async outgoingKnown(clinicId, providerMessageId, phone, body, since) {
      const { data: byId, error } = await admin
        .from('messages')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('provider_message_id', providerMessageId)
        .limit(1)
      check(error)
      if ((byId?.length ?? 0) > 0) return true
      // sendNow e a fila gravam 'sending' antes de chamar a Evolution: o eco pode chegar antes do
      // provider_message_id. Mensagens da fila foram criadas horas antes, então vale o sent_at.
      const { data, error: err2 } = await admin
        .from('messages')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('direction', 'out')
        .in('status', ['sending', 'sent'])
        .eq('phone', phone)
        .eq('body', body)
        .or(`status.eq.sending,sent_at.gte.${since.toISOString()}`)
        .limit(1)
      check(err2)
      return (data?.length ?? 0) > 0
    },

    async saveHumanFromPhone(clinicId, conversationId, phone, body, providerMessageId) {
      const { error } = await admin.from('messages').insert({
        clinic_id: clinicId,
        conversation_id: conversationId,
        phone,
        body,
        type: 'human',
        direction: 'out',
        status: 'sent',
        sent_at: new Date().toISOString(),
        provider_message_id: providerMessageId,
      })
      if (error?.code === '23505') return
      check(error)
    },

    async setHandler(conversationId, handler, reason) {
      const { error } = await admin
        .from('conversations')
        .update({ handler, handoff_reason: handler === 'human' ? reason : null, handler_since: new Date().toISOString() })
        .eq('id', conversationId)
      check(error)
    },

    async markRead(conversationId) {
      const { error } = await admin.from('conversations').update({ unread: false }).eq('id', conversationId)
      check(error)
    },

    async lastIncomingAt(clinicId, phone) {
      const { data, error } = await admin
        .from('messages')
        .select('created_at')
        .eq('clinic_id', clinicId)
        .eq('phone', phone)
        .eq('direction', 'in')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      check(error)
      const at = (data as { created_at: string } | null)?.created_at
      return at ? new Date(at) : null
    },

    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
}
