import type { BudgetStatus, LostReason } from '@/types'

export const LOST_REASONS: { code: LostReason; label: string }[] = [
  { code: 'preco', label: 'Achou caro' },
  { code: 'pensar', label: 'Vai pensar' },
  { code: 'outro_lugar', label: 'Fez em outro lugar' },
  { code: 'tempo', label: 'Sem tempo' },
  { code: 'medo', label: 'Medo ou ansiedade' },
  { code: 'sem_resposta', label: 'Sem resposta' },
  { code: 'outro', label: 'Outro' },
]

export function lostReasonLabel(code: LostReason): string {
  return LOST_REASONS.find(r => r.code === code)?.label ?? code
}

export const STAGE_LABEL: Record<BudgetStatus, string> = {
  draft: 'Rascunho',
  sent: 'Enviado',
  approved: 'Aprovado',
  rejected: 'Perdido: recusado',
  expired: 'Perdido: vencido',
  completed: 'Concluído',
}

export function canSend(b: { status: BudgetStatus; total: number; itemCount: number }):
  { ok: true } | { ok: false; error: string } {
  if (b.status !== 'draft' && b.status !== 'sent') {
    return { ok: false, error: 'Este orçamento não pode mais ser enviado' }
  }
  if (!(b.total > 0) || b.itemCount < 1) {
    return { ok: false, error: 'Adicione ao menos um item com valor antes de enviar' }
  }
  return { ok: true }
}

export function canReopen(status: BudgetStatus): boolean {
  return status === 'rejected' || status === 'expired'
}

export function canDecideByReception(status: BudgetStatus): boolean {
  return status === 'draft' || status === 'sent'
}
