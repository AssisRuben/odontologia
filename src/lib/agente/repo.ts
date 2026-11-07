import type { SupabaseClient } from '@supabase/supabase-js'
import { getAiForClinic } from '@/lib/ia/conexao'
import { WA_AI_OPTIONS } from '@/lib/ia/modelos'
import { createAiDeps, recordUsage } from '@/lib/ia/repo'
import { normalizeMessagingConfig } from '@/lib/messaging/config'
import { sendNow } from '@/lib/messaging/sendNow'
import type { AgentConversation, AgentDeps } from './agente'
import { normalizeAgentConfig } from './config'
import { HISTORY_LIMIT, MAX_NEXT_APPOINTMENTS } from './conversa'
import { createAgendaDeps } from './agendamento/repo'
import { historyBody, historyRole } from './contexto'

function check(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

const CONV_COLUMNS = 'id, clinic_id, phone, patient_id, contact_name, handler, last_message_at, offers, booking_draft, searches'

export function createAgentDeps(admin: SupabaseClient): AgentDeps {
  const aiDeps = createAiDeps(admin, WA_AI_OPTIONS)
  return {
    agenda: createAgendaDeps(admin),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),

    async loadConversation(id) {
      const { data, error } = await admin.from('conversations').select(CONV_COLUMNS).eq('id', id).maybeSingle()
      check(error)
      return (data as AgentConversation | null) ?? null
    },

    async latestIncomingId(conversationId) {
      const { data, error } = await admin
        .from('messages')
        .select('id')
        .eq('conversation_id', conversationId)
        .eq('direction', 'in')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle()
      check(error)
      return (data?.id as string | undefined) ?? null
    },

    async loadClinic(clinicId) {
      const [clinicRes, insRes, connRes] = await Promise.all([
        admin.from('clinics').select('name, address, phone, messaging_config, agent_config').eq('id', clinicId).single(),
        admin.from('insurance_plans').select('name').eq('clinic_id', clinicId).order('name'),
        admin.from('whatsapp_connections').select('status').eq('clinic_id', clinicId).maybeSingle(),
      ])
      check(clinicRes.error)
      check(insRes.error)
      check(connRes.error)
      const c = clinicRes.data as {
        name: string; address: string | null; phone: string | null
        messaging_config: unknown; agent_config: unknown
      }
      return {
        name: c.name,
        address: c.address ?? null,
        phone: c.phone ?? null,
        insurances: ((insRes.data ?? []) as { name: string }[]).map((i) => i.name),
        config: normalizeAgentConfig(c.agent_config),
        timezone: normalizeMessagingConfig(c.messaging_config).timezone,
        whatsappConnected: (connRes.data as { status: string } | null)?.status === 'connected',
      }
    },

    async loadPatient(patientId) {
      const { data, error } = await admin
        .from('patients')
        .select('name, whatsapp_opt_out')
        .eq('id', patientId)
        .maybeSingle()
      check(error)
      if (!data) return null
      return { name: data.name as string, optOut: !!data.whatsapp_opt_out }
    },

    async nextAppointments(clinicId, patientId, now) {
      const { data, error } = await admin
        .from('appointments')
        .select('id, start_time, procedure, professionals(name)')
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .gt('start_time', now.toISOString())
        .in('status', ['scheduled', 'confirmed'])
        .order('start_time', { ascending: true })
        .limit(MAX_NEXT_APPOINTMENTS)
      check(error)
      return ((data ?? []) as unknown as { id: string; start_time: string; procedure: string | null; professionals: { name: string } | { name: string }[] | null }[]).map((a) => {
        const prof = Array.isArray(a.professionals) ? a.professionals[0] : a.professionals
        return { id: a.id, start: a.start_time, procedure: a.procedure ?? null, professional: prof?.name ?? null }
      })
    },

    async history(clinicId, phone) {
      const { data, error } = await admin
        .from('messages')
        .select('direction, type, body')
        .eq('clinic_id', clinicId)
        .eq('phone', phone)
        .in('status', ['sent', 'received'])
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(HISTORY_LIMIT)
      check(error)
      const rows = (data ?? []) as { direction: 'in' | 'out'; type: string; body: string }[]
      return rows.reverse().map((m) => ({ role: historyRole(m), body: historyBody(m.type, m.body) }))
    },

    async agentRepliesSince(conversationId, since) {
      const { count, error } = await admin
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conversationId)
        .eq('type', 'agent')
        .eq('status', 'sent')
        .gte('created_at', since.toISOString())
      check(error)
      return count ?? 0
    },

    getAi: (clinicId) => getAiForClinic(clinicId, aiDeps),

    async setHandler(conversationId, handler, reason) {
      const { error } = await admin
        .from('conversations')
        .update({ handler, handoff_reason: handler === 'human' ? reason : null, handler_since: new Date().toISOString() })
        .eq('id', conversationId)
      check(error)
    },

    async setContactName(conversationId, name) {
      const { error } = await admin.from('conversations').update({ contact_name: name }).eq('id', conversationId)
      check(error)
    },

    async markUnread(conversationId) {
      const { error } = await admin.from('conversations').update({ unread: true }).eq('id', conversationId)
      check(error)
    },

    async markRead(conversationId) {
      const { error } = await admin.from('conversations').update({ unread: false }).eq('id', conversationId)
      check(error)
    },

    async lastActivityBefore(clinicId, phone, messageId) {
      const { data, error } = await admin
        .from('messages')
        .select('created_at')
        .eq('clinic_id', clinicId)
        .eq('phone', phone)
        .in('status', ['sent', 'received'])
        .neq('id', messageId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      check(error)
      return (data?.created_at as string | undefined) ?? null
    },

    async sendAgentMessage(conv, body, extra) {
      const { data, error } = await admin
        .from('whatsapp_connections')
        .select('instance, token, status')
        .eq('clinic_id', conv.clinic_id)
        .maybeSingle()
      check(error)
      if (!data || data.status !== 'connected') return false
      const row = {
        clinic_id: conv.clinic_id,
        patient_id: conv.patient_id,
        conversation_id: conv.id,
        type: 'agent',
        direction: 'out',
        phone: conv.phone,
        body,
        ...(extra ? { appointment_id: extra.appointmentId, agent_action: extra.agentAction } : {}),
      }
      const res = await sendNow(admin, { instance: data.instance as string, token: data.token as string }, row)
      if (!res.ok) return false
      const { error: upErr } = await admin
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', conv.id)
      check(upErr)
      return true
    },

    recordUsage: (clinicId, row) => recordUsage(admin, clinicId, null, row),
  }
}

/** Busca ou cria a conversa (clinic_id, phone); em corrida, o índice único faz o segundo insert reler. */
export async function upsertConversation(
  admin: SupabaseClient,
  clinicId: string,
  phone: string,
  patientId: string | null,
  at: Date,
): Promise<string> {
  const iso = at.toISOString()
  const { data, error } = await admin
    .from('conversations')
    .insert({ clinic_id: clinicId, phone, patient_id: patientId, last_message_at: iso, unread: true })
    .select('id')
    .single()
  if (!error) return data!.id as string
  if ((error as { code?: string }).code !== '23505') throw new Error(error.message)

  const { data: existing, error: readErr } = await admin
    .from('conversations')
    .select('id, patient_id')
    .eq('clinic_id', clinicId)
    .eq('phone', phone)
    .single()
  check(readErr)
  const patch: Record<string, unknown> = { last_message_at: iso, unread: true }
  if (!existing!.patient_id && patientId) patch.patient_id = patientId
  const { error: upErr } = await admin.from('conversations').update(patch).eq('id', existing!.id)
  check(upErr)
  return existing!.id as string
}
