import type { MovementKind } from '@/types'

export const KIND_LABEL: Record<MovementKind, string> = {
  compra: 'Compra',
  devolucao: 'Devolução',
  ajuste: 'Ajuste',
  uso: 'Uso',
  perda: 'Perda',
  vencido: 'Vencido',
}

export const KINDS_ENTRADA = ['compra', 'devolucao', 'ajuste'] as const
export const KINDS_SAIDA = ['uso', 'perda', 'vencido'] as const
