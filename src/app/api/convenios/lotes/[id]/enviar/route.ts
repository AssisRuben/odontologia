import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { createConveniosRepo } from '@/lib/convenios/repo'
import { parseEnvio, respostaDeErro } from '@/lib/convenios/rotas'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: RouteContext<'/api/convenios/lotes/[id]/enviar'>) {
  const { id } = await ctx.params
  return withClinic('convenios lotes enviar POST', async ({ clinicId, admin }) => {
    if (!isUuid(id)) return { status: 422, body: { error: 'Identificador inválido' } }
    const body = await req.json().catch(() => null)
    const p = parseEnvio(body)
    if (!p.ok) return { status: 422, body: { error: p.error } }
    try {
      await createConveniosRepo(admin).enviarLote(clinicId, id, p.protocol, p.sentAt)
      return { status: 200, body: { ok: true } }
    } catch (e) {
      return respostaDeErro(e)
    }
  })
}
