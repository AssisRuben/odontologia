import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { createConveniosRepo } from '@/lib/convenios/repo'
import { todayYmd } from '@/lib/messaging/time'
import { validarRecebimento } from '@/lib/convenios/pagamentos/validar'
import { ERROS_RECURSO, respostaDeErro } from '@/lib/convenios/rotas'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: RouteContext<'/api/convenios/itens/[id]/recurso/recebimento'>) {
  const { id } = await ctx.params
  return withClinic('convenios itens recurso recebimento POST', async ({ clinicId, admin }) => {
    if (!isUuid(id)) return { status: 422, body: { error: 'Identificador inválido' } }
    const body = await req.json().catch(() => null)
    const repo = createConveniosRepo(admin)
    const item = await repo.itemRecurso(clinicId, id)
    if (!item) return { status: 404, body: { error: 'Item não encontrado' } }
    if (item.lote_status !== 'pago') return { status: 409, body: { error: 'Lote não está pago' } }
    if (item.appeal_status !== 'aceito' || item.recovered_payment_id || item.recovered_value === null) {
      return { status: 409, body: { error: 'Recurso não está aceito ou já foi recebido' } }
    }
    const v = validarRecebimento(body, item.recovered_value, todayYmd(new Date(), 'America/Sao_Paulo'))
    if (!v.ok) return { status: v.status, body: { error: v.error } }
    try {
      await repo.receberRecurso(clinicId, id, v.dados.value, v.dados.receivedAt)
      return { status: 200, body: { ok: true } }
    } catch (e) {
      return respostaDeErro(e, ERROS_RECURSO)
    }
  })
}
