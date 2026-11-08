import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { createConveniosRepo } from '@/lib/convenios/repo'
import { respostaDeErro } from '@/lib/convenios/rotas'
import { validarResposta } from '@/lib/convenios/guias'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: RouteContext<'/api/guias/[id]/resposta'>) {
  const { id } = await ctx.params
  const body = await req.json().catch(() => null)
  return withClinic('guias resposta POST', async ({ clinicId, admin }) => {
    if (!isUuid(id)) return { status: 422, body: { error: 'Identificador inválido' } }
    const repo = createConveniosRepo(admin)
    const itens = await repo.itensDaGuia(clinicId, id)
    if (!itens) return { status: 404, body: { error: 'Guia não encontrada' } }
    const v = validarResposta(body, itens)
    if (!v.ok) return { status: 422, body: { error: v.error } }
    try {
      const status = await repo.responderGuia(clinicId, id, v.resposta)
      return { status: 200, body: { status } }
    } catch (e) {
      return respostaDeErro(e)
    }
  })
}
