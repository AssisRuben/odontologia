import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { createConveniosRepo } from '@/lib/convenios/repo'
import { respostaDeErro } from '@/lib/convenios/rotas'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, ctx: RouteContext<'/api/guias/[id]/cancelar'>) {
  const { id } = await ctx.params
  return withClinic('guias cancelar POST', async ({ clinicId, admin }) => {
    if (!isUuid(id)) return { status: 422, body: { error: 'Identificador inválido' } }
    try {
      await createConveniosRepo(admin).cancelarGuia(clinicId, id)
      return { status: 200, body: { ok: true } }
    } catch (e) {
      return respostaDeErro(e)
    }
  })
}
