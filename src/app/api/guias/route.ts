import type { NextRequest } from 'next/server'
import { withClinic } from '@/lib/ia/rotas'
import { createConveniosRepo } from '@/lib/convenios/repo'
import { parseCriarGuia, respostaDeErro } from '@/lib/convenios/rotas'
import { montarItens, statusInicial, validarCriacaoGuia } from '@/lib/convenios/guias'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  return withClinic('guias POST', async ({ clinicId, admin }) => {
    const p = parseCriarGuia(body)
    if (!p.ok) return { status: 422, body: { error: p.error } }
    const { patientId, insurancePlanId, professionalId, treatmentIds } = p.input
    const repo = createConveniosRepo(admin)

    const paciente = await repo.paciente(clinicId, patientId)
    if (!paciente) return { status: 404, body: { error: 'Paciente não encontrado' } }
    if (!(await repo.convenioExiste(clinicId, insurancePlanId))) {
      return { status: 404, body: { error: 'Convênio não encontrado' } }
    }
    if (professionalId && !(await repo.profissionalExiste(clinicId, professionalId))) {
      return { status: 422, body: { error: 'Profissional inválido' } }
    }

    const tratamentos = await repo.tratamentosParaGuia(clinicId, treatmentIds)
    const v = validarCriacaoGuia({ patientId, insurancePlanId, treatmentIds }, tratamentos)
    if (!v.ok) return { status: 422, body: { error: v.error } }

    const porId = new Map(tratamentos.map((t) => [t.id, t]))
    const itens = montarItens(treatmentIds.map((id) => porId.get(id)!))
    const status = statusInicial(itens)
    try {
      const id = await repo.criarGuia(clinicId, {
        patientId,
        planId: insurancePlanId,
        professionalId,
        card: paciente.insurance_card,
        status,
        itens,
      })
      return { status: 201, body: { id, status } }
    } catch (e) {
      return respostaDeErro(e)
    }
  })
}
