// Prontidão de um item de guia para entrar em lote. Datas são 'YYYY-MM-DD'.

import type { ItemAuthorization, TreatmentStatus } from '@/types'

/** Pronto = ativo, autorizado (ou sem exigência), fora de lote e com tratamento concluído. */
export function itemPronto(
  item: { active: boolean; authorization: ItemAuthorization; batch_id: string | null },
  trat: { status: TreatmentStatus } | null,
): boolean {
  if (!item.active || item.batch_id !== null) return false
  if (item.authorization !== 'autorizado' && item.authorization !== 'nao_exige') return false
  return trat?.status === 'completed'
}

/** Data de execução: `executed_at` do item, senão a data de conclusão do tratamento. */
export function dataExecucao(
  item: { executed_at: string | null },
  trat: { completed_at: string | null } | null,
): string | null {
  if (item.executed_at) return item.executed_at
  return trat?.completed_at ? trat.completed_at.slice(0, 10) : null
}
