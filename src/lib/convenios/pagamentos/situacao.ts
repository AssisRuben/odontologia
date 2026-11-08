// Situação de pagamento de um item de guia dentro de um lote pago.

import type { AppealStatus } from '@/types'

export type SituacaoPagamento =
  | 'aguardando' | 'pago' | 'glosado' | 'em_recurso' | 'recuperado' | 'glosa_definitiva' | 'aceito_aguardando'

export function situacaoPagamento(item: {
  paid_value: number | null
  glosa_value: number | null
  appeal_status: AppealStatus
  recovered_value: number | null
  recovered_payment_id: string | null
}): SituacaoPagamento {
  if (item.paid_value === null) return 'aguardando'
  if (!item.glosa_value || item.glosa_value <= 0) return 'pago'
  switch (item.appeal_status) {
    case 'em_recurso': return 'em_recurso'
    case 'negado': return 'glosa_definitiva'
    case 'aceito': return item.recovered_payment_id ? 'recuperado' : 'aceito_aguardando'
    default: return 'glosado'
  }
}

const ROTULOS: Record<SituacaoPagamento, string> = {
  aguardando: 'Aguardando pagamento',
  pago: 'Pago',
  glosado: 'Glosado',
  em_recurso: 'Em recurso',
  recuperado: 'Recuperado',
  glosa_definitiva: 'Glosa definitiva',
  aceito_aguardando: 'Aceito — aguardando pagamento',
}

export function rotuloSituacao(s: SituacaoPagamento): string {
  return ROTULOS[s]
}
