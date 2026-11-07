import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { INVALID_ID, NOT_FOUND } from '@/lib/agente/caixa'
import { contactLabel } from '@/lib/agente/conversa'
import { historyRole } from '@/lib/agente/contexto'
import { normalizeAgentConfig } from '@/lib/agente/config'

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
    }))
    const { error: readErr } = await admin.from('conversations').update({ unread: false }).eq('id', id).eq('clinic_id', clinicId)
    if (readErr) throw new Error(readErr.message)
    const { data: clinic, error: clinicErr } = await admin.from('clinics').select('agent_config').eq('id', clinicId).single()
    if (clinicErr) throw new Error(clinicErr.message)
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
