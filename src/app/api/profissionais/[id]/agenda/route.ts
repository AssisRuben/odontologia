import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { validarAgenda } from '@/lib/agente/agendamento/rotas'

export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await req.json().catch(() => null)
  return withClinic('profissional agenda PUT', async ({ clinicId, admin }) => {
    if (!isUuid(id)) return { status: 422, body: { error: 'Identificador inválido' } }
    const v = validarAgenda(body)
    if (!v.ok) return { status: 422, body: { error: v.error } }
    const { data, error } = await admin
      .from('professionals')
      .update({ whatsapp_booking: v.whatsapp_booking, working_hours: v.hours })
      .eq('id', id)
      .eq('clinic_id', clinicId)
      .select('id')
    if (error) throw new Error(error.message)
    if (!data?.length) return { status: 404, body: { error: 'Profissional não encontrado' } }
    return { status: 200, body: { ok: true } }
  })
}
