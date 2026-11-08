import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { respostaDeErro } from '@/lib/convenios/rotas'
import { createComissoesRepo } from '@/lib/comissoes/repo'
import { ERROS_COMISSAO } from '@/lib/comissoes/rotas'

export const dynamic = 'force-dynamic'

export async function DELETE(_req: NextRequest, ctx: RouteContext<'/api/comissoes/fechamentos/[id]'>) {
  const { id } = await ctx.params
  return withClinic('comissoes fechamentos DELETE', async ({ clinicId, admin }) => {
    if (!isUuid(id)) return { status: 422, body: { error: 'Identificador inválido' } }
    try {
      await createComissoesRepo(admin).reabrir(clinicId, id)
      return { status: 200, body: { ok: true } }
    } catch (e) {
      return respostaDeErro(e, ERROS_COMISSAO)
    }
  })
}
