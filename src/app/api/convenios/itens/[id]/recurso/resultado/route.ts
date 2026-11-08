import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { createConveniosRepo } from '@/lib/convenios/repo'
import { todayYmd } from '@/lib/messaging/time'
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
    const v = validarResultado(body, item.glosa_value, todayYmd(new Date(), 'America/Sao_Paulo'))
    if (!v.ok) return { status: v.status, body: { error: v.error } }
    if (item.lote_status !== 'pago') return { status: 409, body: { error: 'Lote não está pago' } }
    const { resultado, resultAt, recoveredValue, receivedAt } = v.dados
    if (!(await repo.registrarResultado(clinicId, id, { resultado, resultAt, recoveredValue }))) {
      return { status: 409, body: { error: 'Recurso não está aceito ou já foi recebido' } }
    }
    if (resultado !== 'aceito') return { status: 200, body: { ok: true, status: resultado } }
    if (!receivedAt || recoveredValue === null) return { status: 200, body: { ok: true, status: 'aceito' } }
    try {
      await repo.receberRecurso(clinicId, id, recoveredValue, receivedAt)
      return { status: 200, body: { status: 'aceito', recebido: true } }
    } catch (e) {
      // O resultado já foi gravado: não devolver erro para o cliente não repetir a chamada.
      let texto = 'Erro interno. Tente novamente.'
      try {
        texto = respostaDeErro(e, ERROS_RECURSO).body.error
      } catch {
        console.error('[convenios itens recurso resultado POST] recebimento falhou:', (e as Error)?.message)
      }
      return {
        status: 200,
        body: {
          status: 'aceito',
          recebido: false,
          aviso: `Resultado gravado, mas o recebimento não foi registrado: ${texto}`,
        },
      }
    }
  })
}
