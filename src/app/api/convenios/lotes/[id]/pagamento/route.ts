import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { createConveniosRepo } from '@/lib/convenios/repo'
import { todayYmd } from '@/lib/messaging/time'
import { validarPagamento } from '@/lib/convenios/pagamentos/validar'
import { ERROS_PAGAMENTO, respostaDeErro } from '@/lib/convenios/rotas'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: RouteContext<'/api/convenios/lotes/[id]/pagamento'>) {
  const { id } = await ctx.params
  return withClinic('convenios lotes pagamento POST', async ({ clinicId, admin }) => {
    if (!isUuid(id)) return { status: 422, body: { error: 'Identificador inválido' } }
    const body = await req.json().catch(() => null)
    const repo = createConveniosRepo(admin)
    const lote = await repo.itensDoLote(clinicId, id)
    if (!lote) return { status: 404, body: { error: 'Lote não encontrado' } }
    const v = validarPagamento(body, lote.itens, todayYmd(new Date(), 'America/Sao_Paulo'))
    if (!v.ok) return { status: v.status, body: { error: v.error } }
    try {
      await repo.registrarPagamento(clinicId, id, v.dados)
      return { status: 200, body: { ok: true } }
    } catch (e) {
      return respostaDeErro(e, ERROS_PAGAMENTO)
    }
  })
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<'/api/convenios/lotes/[id]/pagamento'>) {
  const { id } = await ctx.params
  return withClinic('convenios lotes pagamento DELETE', async ({ clinicId, admin }) => {
    if (!isUuid(id)) return { status: 422, body: { error: 'Identificador inválido' } }
    try {
      await createConveniosRepo(admin).desfazerPagamento(clinicId, id)
      return { status: 200, body: { ok: true } }
    } catch (e) {
      return respostaDeErro(e)
    }
  })
}
