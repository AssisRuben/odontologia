/** Lançamento financeiro importado do sistema anterior (somente leitura). */
export interface LegacyPayment {
  id: string
  clinic_id: string
  patient_id: string
  budget_id: string | null
  source_id: string
  description: string | null
  amount: number
  due_date: string | null
  paid_at: string | null
  payment_method: string | null
  installment_number: number | null
  installment_count: number | null
  original_status: 'paid' | 'open'
  created_at: string
}

const centavos = (valor: number) => Math.round(Number(valor) * 100)

/** Totais do histórico, separando o que foi pago do que ficou em aberto. */
export function resumoHistorico(
  linhas: Pick<LegacyPayment, 'amount' | 'original_status'>[],
): { pago: number; emAberto: number } {
  let pago = 0
  let emAberto = 0
  for (const l of linhas) {
    if (l.original_status === 'paid') pago += centavos(l.amount)
    else emAberto += centavos(l.amount)
  }
  return { pago: pago / 100, emAberto: emAberto / 100 }
}

/** Soma do histórico por orçamento na situação pedida; linhas sem orçamento ficam de fora. */
export function somarPorOrcamento(
  linhas: Pick<LegacyPayment, 'amount' | 'budget_id' | 'original_status'>[],
  situacao: LegacyPayment['original_status'] = 'paid',
): Record<string, number> {
  const somas: Record<string, number> = {}
  for (const l of linhas) {
    if (!l.budget_id || l.original_status !== situacao) continue
    somas[l.budget_id] = (somas[l.budget_id] ?? 0) + centavos(l.amount)
  }
  for (const id of Object.keys(somas)) somas[id] /= 100
  return somas
}
