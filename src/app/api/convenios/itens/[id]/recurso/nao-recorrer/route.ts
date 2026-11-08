import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { createConveniosRepo } from '@/lib/convenios/repo'
import { todayYmd } from '@/lib/messaging/time'

export const dynamic = 'force-dynamic'

/** "Não recorrer": a glosa sem recurso vira definitiva (negado, com a data de hoje). */
export async function POST(_req: NextRequest, ctx: RouteContext<'/api/convenios/itens/[id]/recurso/nao-recorrer'>) {
  const { id } = await ctx.params
  return withClinic('convenios itens nao-recorrer POST', async ({ clinicId, admin }) => {
    if (!isUuid(id)) return { status: 422, body: { error: 'Identificador inválido' } }
    const repo = createConveniosRepo(admin)
    const item = await repo.itemRecurso(clinicId, id)
    if (!item) return { status: 404, body: { error: 'Item não encontrado' } }
    if (item.lote_status !== 'pago') return { status: 409, body: { error: 'Lote não está pago' } }
    const hoje = todayYmd(new Date(), 'America/Sao_Paulo')
    if (item.glosa_value <= 0 || !(await repo.naoRecorrer(clinicId, id, hoje))) {
      return { status: 409, body: { error: 'Item não está glosado' } }
    }
    return { status: 200, body: { ok: true } }
  })
}
