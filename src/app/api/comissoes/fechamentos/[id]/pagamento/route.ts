import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { respostaDeErro } from '@/lib/convenios/rotas'
import { createComissoesRepo } from '@/lib/comissoes/repo'
import { validarPagamentoComissao } from '@/lib/comissoes/validar'
import { ERROS_COMISSAO } from '@/lib/comissoes/rotas'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: RouteContext<'/api/comissoes/fechamentos/[id]/pagamento'>) {
  const { id } = await ctx.params
  return withClinic('comissoes pagamento POST', async ({ clinicId, admin }) => {
    if (!isUuid(id)) return { status: 422, body: { error: 'Identificador inválido' } }
    const v = validarPagamentoComissao(await req.json().catch(() => null))
    if (!v.ok) return { status: v.status, body: { error: v.error } }
    try {
      const expenseId = await createComissoesRepo(admin).pagar(clinicId, id, v.paidAt, v.paymentMethod)
      return { status: 201, body: { expenseId } }
    } catch (e) {
      return respostaDeErro(e, ERROS_COMISSAO)
    }
  })
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<'/api/comissoes/fechamentos/[id]/pagamento'>) {
  const { id } = await ctx.params
  return withClinic('comissoes pagamento DELETE', async ({ clinicId, admin }) => {
    if (!isUuid(id)) return { status: 422, body: { error: 'Identificador inválido' } }
    try {
      await createComissoesRepo(admin).desfazerPagamento(clinicId, id)
      return { status: 200, body: { ok: true } }
    } catch (e) {
      return respostaDeErro(e, ERROS_COMISSAO)
    }
  })
}
