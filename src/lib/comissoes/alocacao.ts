export type RecebimentoIn = {
  id: string
  patient_id: string
  amount: number
  net_amount: number | null
  payment_method: string | null
  paid_at: string
  created_at: string
}

export type TratamentoIn = {
  id: string
  patient_id: string
  professional_id: string | null
  procedure: string
  value: number
  completed_at: string | null
  created_at: string
  em_guia: boolean
}

export type ParteParticular = {
  treatment_id: string
  payment_id: string
  patient_id: string
  professional_id: string | null
  procedure: string
  brutoCentavos: number
  baseCentavos: number
  data: string
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Quita, por paciente, os tratamentos concluídos (do mais antigo ao mais novo)
 * com os recebimentos particulares (do mais antigo ao mais novo).
 * Tratamento sem dentista consome o recebimento, mas sai com `professional_id` nulo.
 */
export function alocarParticular(recebimentos: RecebimentoIn[], tratamentos: TratamentoIn[]): ParteParticular[] {
  const partes: ParteParticular[] = []
  const pacientes = new Set(recebimentos.map(r => r.patient_id))

  for (const patientId of pacientes) {
    const recs = recebimentos
      .filter(r => r.patient_id === patientId && r.payment_method !== 'convenio')
      .sort((a, b) => cmp(a.paid_at, b.paid_at) || cmp(a.created_at, b.created_at) || cmp(a.id, b.id))
    const fila = tratamentos
      .filter(t => t.patient_id === patientId && !t.em_guia && t.value > 0 && t.completed_at)
      .sort((a, b) =>
        cmp(a.completed_at as string, b.completed_at as string) || cmp(a.created_at, b.created_at) || cmp(a.id, b.id))
      .map(t => ({ t, restante: Math.round(t.value * 100) }))

    let i = 0
    for (const r of recs) {
      let disponivel = Math.round(r.amount * 100)
      const fator = r.net_amount !== null && r.amount > 0 ? r.net_amount / r.amount : 1
      while (disponivel > 0 && i < fila.length) {
        const alvo = fila[i]
        const bruto = Math.min(disponivel, alvo.restante)
        partes.push({
          treatment_id: alvo.t.id,
          payment_id: r.id,
          patient_id: patientId,
          professional_id: alvo.t.professional_id,
          procedure: alvo.t.procedure,
          brutoCentavos: bruto,
          baseCentavos: Math.round(bruto * fator),
          data: r.paid_at > (alvo.t.completed_at as string) ? r.paid_at : (alvo.t.completed_at as string),
        })
        disponivel -= bruto
        alvo.restante -= bruto
        if (alvo.restante === 0) i++
      }
    }
  }
  return partes
}
