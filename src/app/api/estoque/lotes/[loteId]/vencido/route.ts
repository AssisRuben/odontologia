import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { respostaDeErro } from '@/lib/convenios/rotas'
import { createEstoqueRepo } from '@/lib/estoque/repo'
import { ERROS_ESTOQUE } from '@/lib/estoque/rotas'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, ctx: { params: Promise<{ loteId: string }> }) {
  const { loteId } = await ctx.params
  return withClinic('estoque lote vencido', async ({ clinicId, userId, admin }) => {
    if (!isUuid(loteId)) return { status: 404, body: { error: 'Lote não encontrado' } }
    try {
      return { status: 200, body: await createEstoqueRepo(admin).baixarLote(clinicId, userId, loteId) }
    } catch (e) {
      return respostaDeErro(e, ERROS_ESTOQUE)
    }
  })
}
