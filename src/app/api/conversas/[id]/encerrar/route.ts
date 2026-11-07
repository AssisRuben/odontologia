import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { INVALID_ID, NOT_FOUND } from '@/lib/agente/caixa'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return withClinic('conversa encerrar', async ({ clinicId, admin }) => {
    if (!isUuid(id)) return { status: 422, body: INVALID_ID }
    const { data, error } = await admin
      .from('conversations')
      .update({ handler: 'agent', handoff_reason: null, handler_since: new Date().toISOString() })
      .eq('id', id)
      .eq('clinic_id', clinicId)
      .select('id')
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) return { status: 404, body: NOT_FOUND }
    return { status: 200, body: { ok: true } }
  })
}
