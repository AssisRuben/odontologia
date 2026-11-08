import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { createConveniosRepo } from '@/lib/convenios/repo'
import { validarRecurso } from '@/lib/convenios/pagamentos/validar'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: RouteContext<'/api/convenios/itens/[id]/recurso'>) {
  const { id } = await ctx.params
  return withClinic('convenios itens recurso POST', async ({ clinicId, admin }) => {
    if (!isUuid(id)) return { status: 422, body: { error: 'Identificador inválido' } }
    const body = await req.json().catch(() => null)
    const v = validarRecurso(body)
    if (!v.ok) return { status: v.status, body: { error: v.error } }
    const repo = createConveniosRepo(admin)
    const item = await repo.itemRecurso(clinicId, id)
    if (!item) return { status: 404, body: { error: 'Item não encontrado' } }
    if (item.lote_status !== 'pago') return { status: 409, body: { error: 'Lote não está pago' } }
    if (item.glosa_value <= 0 || !(await repo.recorrer(clinicId, id, v.dados.appealAt, v.dados.appealText))) {
      return { status: 409, body: { error: 'Item não está glosado' } }
    }
    return { status: 200, body: { ok: true } }
  })
}
