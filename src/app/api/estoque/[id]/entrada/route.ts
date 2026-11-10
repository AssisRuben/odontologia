import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { respostaDeErro } from '@/lib/convenios/rotas'
import { createEstoqueRepo } from '@/lib/estoque/repo'
import { parseEntrada } from '@/lib/estoque/validar'
import { ERROS_ESTOQUE } from '@/lib/estoque/rotas'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return withClinic('estoque entrada', async ({ clinicId, userId, admin }) => {
    if (!isUuid(id)) return { status: 404, body: { error: 'Produto não encontrado' } }
    const v = parseEntrada(await req.json().catch(() => null))
    if (!v.ok) return { status: 422, body: { error: v.error } }
    try {
      return { status: 200, body: await createEstoqueRepo(admin).entrada(clinicId, userId, id, v.input) }
    } catch (e) {
      return respostaDeErro(e, ERROS_ESTOQUE)
    }
  })
}
