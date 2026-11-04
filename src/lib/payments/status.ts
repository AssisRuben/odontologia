import type { ProviderCharge } from './provider'

export type LocalStatus = 'pending' | 'paid' | 'overdue' | 'cancelled' | 'refunded'

export interface LocalPaymentState {
  status: LocalStatus
  due_date: string | null
  hasAuthorizedInvoice: boolean
  /** Valor líquido já gravado; permite detectar reentrega idempotente. */
  net_amount_cents?: number | null
  /** Valor local; permite detectar mudança em PAYMENT_UPDATED. */
  amount_cents?: number
}

export interface PaymentPatch {
  status?: LocalStatus
  paid_at?: string | null
  net_amount_cents?: number | null
  due_date?: string
  amount_cents?: number
  alert?: 'chargeback' | 'refunded_with_invoice'
  becamePaid?: boolean
}

function openStatus(dueDate: string | null, today: string): 'pending' | 'overdue' {
  return dueDate !== null && dueDate < today ? 'overdue' : 'pending'
}

export function applyPaymentEvent(
  state: LocalPaymentState,
  event: string,
  charge: ProviderCharge,
  today: string,
): PaymentPatch | null {
  const { status } = state
  switch (event) {
    case 'PAYMENT_CONFIRMED':
    case 'PAYMENT_RECEIVED':
    case 'PAYMENT_RECEIVED_IN_CASH': {
      if (status === 'refunded') return null
      if (status === 'paid') {
        if (charge.netValueCents === null || charge.netValueCents === state.net_amount_cents) return null
        return { net_amount_cents: charge.netValueCents }
      }
      return {
        status: 'paid',
        paid_at: charge.paidAt,
        net_amount_cents: charge.netValueCents,
        becamePaid: true,
      }
    }
    case 'PAYMENT_OVERDUE':
      return status === 'pending' ? { status: 'overdue' } : null
    case 'PAYMENT_UPDATED': {
      if (status !== 'pending' && status !== 'overdue') return null
      const patch: PaymentPatch = {}
      if (charge.dueDate !== state.due_date) patch.due_date = charge.dueDate
      if (state.amount_cents === undefined || charge.valueCents !== state.amount_cents) {
        patch.amount_cents = charge.valueCents
      }
      const next = openStatus(charge.dueDate, today)
      if (next !== status) patch.status = next
      return Object.keys(patch).length ? patch : null
    }
    case 'PAYMENT_DELETED':
      return status === 'paid' || status === 'refunded' || status === 'cancelled'
        ? null
        : { status: 'cancelled' }
    case 'PAYMENT_RESTORED':
      return status === 'cancelled' ? { status: openStatus(state.due_date, today) } : null
    case 'PAYMENT_REFUNDED': {
      if (status === 'refunded') return null
      const patch: PaymentPatch = { status: 'refunded' }
      if (state.hasAuthorizedInvoice) patch.alert = 'refunded_with_invoice'
      return patch
    }
    case 'PAYMENT_RECEIVED_IN_CASH_UNDONE':
      return status === 'paid'
        ? { status: openStatus(state.due_date, today), paid_at: null, net_amount_cents: null }
        : null
    case 'PAYMENT_CHARGEBACK_REQUESTED':
      return { alert: 'chargeback' }
    default:
      return null
  }
}

export function applyProviderStatus(
  state: LocalPaymentState,
  charge: ProviderCharge,
  today: string,
): PaymentPatch | null {
  if (charge.deleted) return applyPaymentEvent(state, 'PAYMENT_DELETED', charge, today)
  switch (charge.status) {
    case 'CONFIRMED':
    case 'RECEIVED':
    case 'RECEIVED_IN_CASH':
      return applyPaymentEvent(state, 'PAYMENT_RECEIVED', charge, today)
    case 'REFUNDED':
      return applyPaymentEvent(state, 'PAYMENT_REFUNDED', charge, today)
    case 'CHARGEBACK_REQUESTED':
      return applyPaymentEvent(state, 'PAYMENT_CHARGEBACK_REQUESTED', charge, today)
    case 'OVERDUE':
      if (state.status === 'cancelled') {
        return { status: 'overdue', due_date: charge.dueDate, amount_cents: charge.valueCents }
      }
      return applyPaymentEvent(state, 'PAYMENT_OVERDUE', charge, today)
    case 'PENDING': {
      if (state.status === 'paid') {
        return applyPaymentEvent(state, 'PAYMENT_RECEIVED_IN_CASH_UNDONE', charge, today)
      }
      if (state.status === 'cancelled') {
        const patch = applyPaymentEvent(state, 'PAYMENT_RESTORED', charge, today) ?? {}
        return { ...patch, due_date: charge.dueDate, amount_cents: charge.valueCents,
          status: openStatus(charge.dueDate, today) }
      }
      return applyPaymentEvent(state, 'PAYMENT_UPDATED', charge, today)
    }
    default:
      return null
  }
}
