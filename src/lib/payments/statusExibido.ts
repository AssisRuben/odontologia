import type { PaymentStatus } from '@/types'

// Apenas exibição: lançamento pendente com vencimento anterior a hoje aparece como atrasado.
export function statusExibido(
  p: { status: PaymentStatus; due_date?: string | null },
  hoje: string,
): PaymentStatus {
  if (p.status === 'pending' && p.due_date && p.due_date.slice(0, 10) < hoje) return 'overdue'
  return p.status
}
