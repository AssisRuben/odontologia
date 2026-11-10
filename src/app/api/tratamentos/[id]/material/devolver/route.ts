import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { respostaDeErro } from '@/lib/convenios/rotas'
import { createKitsRepo } from '@/lib/kits/repo'
import { ERROS_KITS } from '@/lib/kits/rotas'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return withClinic('tratamento devolver', async ({ clinicId, userId, admin }) => {
    if (!isUuid(id)) return { status: 404, body: { error: 'Tratamento não encontrado' } }
    try {
      return { status: 200, body: await createKitsRepo(admin).devolver(clinicId, userId, id) }
    } catch (e) {
      return respostaDeErro(e, ERROS_KITS)
    }
  })
}
