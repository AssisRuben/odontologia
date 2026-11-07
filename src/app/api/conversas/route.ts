import type { NextRequest } from 'next/server'
import { withClinic } from '@/lib/ia/rotas'
import { parseFiltro } from '@/lib/agente/caixa'
import { contactLabel } from '@/lib/agente/conversa'

export const dynamic = 'force-dynamic'

const PAGE = 30
const COLUMNS = 'id, clinic_id, phone, patient_id, contact_name, handler, handoff_reason, handler_since, last_message_at, unread, created_at, patients(name)'

export async function GET(req: NextRequest) {
  const filtro = parseFiltro(req.nextUrl.searchParams.get('filtro'))
  const antes = req.nextUrl.searchParams.get('antes')
  return withClinic('conversas GET', async ({ clinicId, admin }) => {
    if (antes && Number.isNaN(Date.parse(antes))) return { status: 422, body: { error: 'Cursor inválido' } }
    let q = admin.from('conversations').select(COLUMNS).eq('clinic_id', clinicId)
    if (filtro === 'aguardando') q = q.or('handler.eq.human,unread.eq.true')
    else if (filtro === 'agente') q = q.eq('handler', 'agent')
    if (antes) q = q.lt('last_message_at', antes)
    const { data, error } = await q.order('last_message_at', { ascending: false }).limit(PAGE)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as unknown as (Record<string, unknown> & {
      id: string; phone: string; contact_name: string | null
      patients: { name: string } | { name: string }[] | null
    })[]
    const conversas = await Promise.all(rows.map(async (r) => {
      const { patients, ...conv } = r
      const p = Array.isArray(patients) ? patients[0] : patients
      const { data: last, error: lastErr } = await admin
        .from('messages')
        .select('body')
        .eq('clinic_id', clinicId)
        .eq('phone', r.phone)
        .in('status', ['sent', 'received'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (lastErr) throw new Error(lastErr.message)
      return {
        ...conv,
        label: contactLabel({ patientName: p?.name ?? null, contact_name: r.contact_name, phone: r.phone }),
        ultima: (last?.body as string | undefined) ?? null,
      }
    }))
    return { status: 200, body: { conversas } }
  })
}
