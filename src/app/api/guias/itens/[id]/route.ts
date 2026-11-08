import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { createConveniosRepo } from '@/lib/convenios/repo'
import { parseExecutado } from '@/lib/convenios/rotas'

export const dynamic = 'force-dynamic'

const EM_LOTE = { status: 409, body: { error: 'Item em lote não pode ser alterado' } }

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await req.json().catch(() => null)
  return withClinic('guias item PATCH', async ({ clinicId, admin }) => {
    if (!isUuid(id)) return { status: 422, body: { error: 'Identificador inválido' } }
    const p = parseExecutado(body)
    if (!p.ok) return { status: 422, body: { error: p.error } }
    const repo = createConveniosRepo(admin)
    const item = await repo.item(clinicId, id)
    if (!item) return { status: 404, body: { error: 'Item não encontrado' } }
    if (item.batch_id) return EM_LOTE
    if (!(await repo.corrigirExecucao(clinicId, id, p.executedAt))) return EM_LOTE
    return { status: 200, body: { ok: true } }
  })
}
