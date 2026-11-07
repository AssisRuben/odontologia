import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { INVALID_ID, parseResposta, responderConversa } from '@/lib/agente/caixa'
import { createResponderDeps } from '@/lib/agente/caixaRepo'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await req.json().catch(() => null)
  return withClinic('conversa responder', async ({ clinicId, admin }) => {
    if (!isUuid(id)) return { status: 422, body: INVALID_ID }
    const p = parseResposta(body)
    if (!p.ok) return { status: 422, body: { error: p.error } }
    return responderConversa(createResponderDeps(admin), clinicId, id, p.texto)
  })
}
