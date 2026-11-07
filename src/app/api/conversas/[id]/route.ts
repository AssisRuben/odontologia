import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { INVALID_ID, NOT_FOUND } from '@/lib/agente/caixa'
import { contactLabel } from '@/lib/agente/conversa'
import { historyRole } from '@/lib/agente/contexto'
import { normalizeAgentConfig } from '@/lib/agente/config'
import { normalizeMessagingConfig } from '@/lib/messaging/config'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return withClinic('conversa GET', async ({ clinicId, admin }) => {
    if (!isUuid(id)) return { status: 422, body: INVALID_ID }
    const { data, error } = await admin
      .from('conversations')
      .select('*, patients(name)')
      .eq('id', id)
      .eq('clinic_id', clinicId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return { status: 404, body: NOT_FOUND }
    const { patients, ...conv } = data as Record<string, unknown> & {
      phone: string; contact_name: string | null
      patients: { name: string } | { name: string }[] | null
    }
    const p = Array.isArray(patients) ? patients[0] : patients
    const { data: msgs, error: msgErr } = await admin
      .from('messages')
      .select('id, direction, type, body, transcribed, created_at, sent_at, appointment_id, agent_action')
      .eq('clinic_id', clinicId)
      .eq('phone', conv.phone)
      .in('status', ['sent', 'received'])
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(100)
    if (msgErr) throw new Error(msgErr.message)
    const aptIds = [...new Set(((msgs ?? []) as { appointment_id: string | null }[]).map((m) => m.appointment_id).filter((x): x is string => !!x))]
    const aptStart = new Map<string, string>()
    if (aptIds.length > 0) {
      const { data: apts, error: aptErr } = await admin
        .from('appointments').select('id, start_time').eq('clinic_id', clinicId).in('id', aptIds)
      if (aptErr) throw new Error(aptErr.message)
      for (const a of (apts ?? []) as { id: string; start_time: string }[]) aptStart.set(a.id, a.start_time)
    }
    const { data: clinic, error: clinicErr } = await admin.from('clinics').select('agent_config, messaging_config').eq('id', clinicId).single()
    if (clinicErr) throw new Error(clinicErr.message)
    const tz = normalizeMessagingConfig((clinic as { messaging_config: unknown }).messaging_config).timezone
    const dayOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
    const mensagens = ((msgs ?? []) as {
      id: string; direction: 'in' | 'out'; type: string; body: string
      transcribed: boolean; created_at: string; sent_at: string | null
      appointment_id: string | null; agent_action: string | null
    }[]).reverse().map((m) => ({
      id: m.id,
      role: historyRole(m),
      body: m.body,
      transcribed: !!m.transcribed,
      at: m.sent_at ?? m.created_at,
      appointment_id: m.appointment_id ?? null,
      agent_action: m.agent_action ?? null,
      appointment_date: m.appointment_id && aptStart.has(m.appointment_id) ? dayOf(aptStart.get(m.appointment_id)!) : null,
    }))
    const { error: readErr } = await admin.from('conversations').update({ unread: false }).eq('id', id).eq('clinic_id', clinicId)
    if (readErr) throw new Error(readErr.message)
    return {
      status: 200,
      body: {
        conversa: {
          ...conv,
          unread: false,
          label: contactLabel({ patientName: p?.name ?? null, contact_name: conv.contact_name, phone: conv.phone }),
        },
        mensagens,
        agenteLigado: normalizeAgentConfig((clinic as { agent_config: unknown }).agent_config).enabled,
      },
    }
  })
}
