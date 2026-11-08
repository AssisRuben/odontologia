import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { createConveniosRepo } from '@/lib/convenios/repo'
import { respostaDeErro } from '@/lib/convenios/rotas'

export const dynamic = 'force-dynamic'

/** Recopia código, nome, dentes e valor a partir do tratamento e da tabela do convênio. */
export async function POST(_req: NextRequest, ctx: RouteContext<'/api/guias/itens/[id]/atualizar'>) {
  const { id } = await ctx.params
  return withClinic('guias item atualizar POST', async ({ clinicId, admin }) => {
    if (!isUuid(id)) return { status: 422, body: { error: 'Identificador inválido' } }
    const repo = createConveniosRepo(admin)
    const item = await repo.item(clinicId, id)
    if (!item) return { status: 404, body: { error: 'Item não encontrado' } }
    if (item.batch_id) return { status: 409, body: { error: 'Item em lote não pode ser alterado' } }

    const [t] = item.treatment_id ? await repo.tratamentosParaGuia(clinicId, [item.treatment_id]) : []
    if (
      !t || !t.procedimento || !item.guide ||
      t.insurance_plan_id !== item.guide.insurance_plan_id || t.patient_id !== item.guide.patient_id
    ) {
      return { status: 422, body: { error: 'Tratamento fora da tabela do convênio' } }
    }
    try {
      await repo.atualizarItem(clinicId, id, {
        code: t.procedimento.code,
        name: t.procedimento.name,
        teeth: t.teeth,
        value: t.value,
      })
      return { status: 200, body: { ok: true } }
    } catch (e) {
      return respostaDeErro(e)
    }
  })
}
