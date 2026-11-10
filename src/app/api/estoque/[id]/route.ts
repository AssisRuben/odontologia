import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { respostaDeErro } from '@/lib/convenios/rotas'
import { createEstoqueRepo } from '@/lib/estoque/repo'
import { parseProduto } from '@/lib/estoque/validar'
import { ERROS_ESTOQUE } from '@/lib/estoque/rotas'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return withClinic('estoque PATCH', async ({ clinicId, admin }) => {
    if (!isUuid(id)) return { status: 404, body: { error: 'Produto não encontrado' } }
    const v = parseProduto(await req.json().catch(() => null), false)
    if (!v.ok) return { status: 422, body: { error: v.error } }
    try {
      await createEstoqueRepo(admin).editar(clinicId, id, v.input)
      return { status: 200, body: { ok: true } }
    } catch (e) {
      return respostaDeErro(e, ERROS_ESTOQUE)
    }
  })
}
