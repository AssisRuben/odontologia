import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { createConveniosRepo } from '@/lib/convenios/repo'
import { parseItemLote, respostaDeErro } from '@/lib/convenios/rotas'
import { adiarAte } from '@/lib/convenios/lotes'

export const dynamic = 'force-dynamic'

const ITEM_NAO_ENCONTRADO = { status: 404, body: { error: 'Item não encontrado' } }

export async function PATCH(req: NextRequest, ctx: RouteContext<'/api/convenios/lotes/[id]/itens/[itemId]'>) {
  const { id, itemId } = await ctx.params
  return withClinic('convenios lotes item PATCH', async ({ clinicId, admin }) => {
    if (!isUuid(id) || !isUuid(itemId)) return { status: 422, body: { error: 'Identificador inválido' } }
    const body = await req.json().catch(() => null)
    const p = parseItemLote(body)
    if (!p.ok) return { status: 422, body: { error: p.error } }
    const repo = createConveniosRepo(admin)
    try {
      if ('typed' in p.acao) {
        const ok = await repo.marcarDigitado(clinicId, id, itemId, p.acao.typed)
        return ok ? { status: 200, body: { ok: true } } : ITEM_NAO_ENCONTRADO
      }
      const lote = await repo.lote(clinicId, id)
      if (!lote) return { status: 404, body: { error: 'Lote não encontrado' } }
      const item = await repo.item(clinicId, itemId)
      if (!item || item.batch_id !== id) return ITEM_NAO_ENCONTRADO
      if (lote.closing_day === null) return { status: 409, body: { error: 'Convênio sem dia de fechamento' } }
      await repo.removerDoLote(clinicId, id, itemId, adiarAte(lote.period_end, lote.closing_day))
      return { status: 200, body: { ok: true } }
    } catch (e) {
      return respostaDeErro(e)
    }
  })
}
