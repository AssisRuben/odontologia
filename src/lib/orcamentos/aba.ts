import type { BudgetEvent, BudgetStatus } from '@/types'
import { lostReasonLabel } from '@/lib/orcamentos/etapas'
import type { LostReason } from '@/types'

const CONTACT_LABEL: Record<string, string> = {
  nao_atendeu: 'Não atendeu',
  pensar: 'Vai pensar',
  aprovou: 'Aprovou',
  perdido: 'Perdido',
}

export function eventLabel(e: Pick<BudgetEvent, 'type' | 'outcome' | 'reason' | 'created_by'>): string {
  switch (e.type) {
    case 'sent': return 'Enviado'
    case 'resent': return 'Reenviado'
    case 'reminder': return 'Lembrete enviado'
    case 'viewed': return 'Visualizado pelo paciente'
    case 'contact': return `Contato: ${e.outcome ? (CONTACT_LABEL[e.outcome] ?? e.outcome) : 'registrado'}`
    case 'approved': return e.created_by ? 'Aprovado pela recepção' : 'Aprovado (assinado)'
    case 'rejected': return e.reason ? `Perdido: ${lostReasonLabel(e.reason as LostReason)}` : 'Perdido'
    case 'expired': return 'Vencido'
    case 'reopened': return 'Reaberto'
    case 'edited': return 'Editado (link desativado)'
    default: return e.type
  }
}

export interface BudgetActions {
  send: boolean
  resend: boolean
  copyLink: boolean
  decide: boolean
  reopen: boolean
  receipt: boolean
  charge: boolean
  complete: boolean
  editValidity: boolean
  editProfessional: boolean
}

export function actionsFor(status: BudgetStatus, remainingToCharge: number): BudgetActions {
  const open = status === 'draft' || status === 'sent'
  const won = status === 'approved' || status === 'completed'
  return {
    send: status === 'draft',
    resend: status === 'sent',
    copyLink: status === 'sent',
    decide: open,
    reopen: status === 'rejected' || status === 'expired',
    receipt: won,
    charge: won && remainingToCharge > 0.004,
    complete: status === 'approved',
    editValidity: open,
    editProfessional: open,
  }
}

export function parseValidityDays(raw: string): { ok: true; days: number } | { ok: false; error: string } {
  const s = raw.trim()
  const n = Number(s)
  if (!/^\d+$/.test(s) || !Number.isInteger(n) || n < 1 || n > 180) {
    return { ok: false, error: 'Informe de 1 a 180 dias' }
  }
  return { ok: true, days: n }
}
