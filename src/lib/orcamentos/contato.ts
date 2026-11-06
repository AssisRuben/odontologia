import type { BudgetContactOutcome } from '@/types'

/** Soma dias a uma data YYYY-MM-DD (calendário, sem fuso). */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export function contactOutcome(
  outcome: BudgetContactOutcome,
  chosenDate: string | null,
  today: string,
): { followup_at: string | null; next: 'none' | 'approve' | 'lose' } {
  switch (outcome) {
    case 'nao_atendeu': return { followup_at: addDaysYmd(today, 1), next: 'none' }
    case 'pensar': return { followup_at: chosenDate || addDaysYmd(today, 3), next: 'none' }
    case 'aprovou': return { followup_at: null, next: 'approve' }
    case 'perdido': return { followup_at: null, next: 'lose' }
  }
}
