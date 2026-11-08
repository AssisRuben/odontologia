import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { createConveniosRepo } from '@/lib/convenios/repo'
import { validarResultado } from '@/lib/convenios/pagamentos/validar'
import { ERROS_RECURSO, respostaDeErro } from '@/lib/convenios/rotas'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: RouteContext<'/api/convenios/itens/[id]/recurso/resultado'>) {
  const { id } = await ctx.params
  return withClinic('convenios itens recurso resultado POST', async ({ clinicId, admin }) => {
    if (!isUuid(id)) return { status: 422, body: { error: 'Identificador inválido' } }
    const body = await req.json().catch(() => null)
    const repo = createConveniosRepo(admin)
    const item = await repo.itemRecurso(clinicId, id)
    if (!item) return { status: 404, body: { error: 'Item não encontrado' } }
    const v = validarResultado(body, item.glosa_value)
    if (!v.ok) return { status: v.status, body: { error: v.error } }
    if (item.lote_status !== 'pago') return { status: 409, body: { error: 'Lote não está pago' } }
    const { resultado, resultAt, recoveredValue, receivedAt } = v.dados
    if (!(await repo.registrarResultado(clinicId, id, { resultado, resultAt, recoveredValue }))) {
      return { status: 409, body: { error: 'Recurso não está aceito ou já foi recebido' } }
    }
    if (resultado === 'aceito' && receivedAt && recoveredValue !== null) {
      try {
        await repo.receberRecurso(clinicId, id, recoveredValue, receivedAt)
      } catch (e) {
        return respostaDeErro(e, ERROS_RECURSO)
      }
    }
    return { status: 200, body: { ok: true } }
  })
}
