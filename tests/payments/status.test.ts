import { describe, expect, it } from 'vitest'
import { applyPaymentEvent, applyProviderStatus, type LocalPaymentState } from '@/lib/payments/status'
import type { ProviderCharge } from '@/lib/payments/provider'

const TODAY = '2027-01-15'
const charge = (o: Partial<ProviderCharge> = {}): ProviderCharge => ({
  id: 'pay_1', installmentId: null, installmentNumber: null, status: 'PENDING', deleted: false,
  valueCents: 10000, netValueCents: 9500, dueDate: '2027-02-01', paidAt: '2027-01-14',
  invoiceUrl: null, externalReference: null, ...o,
})
const st = (o: Partial<LocalPaymentState> = {}): LocalPaymentState => ({
  status: 'pending', due_date: '2027-02-01', hasAuthorizedInvoice: false, ...o,
})

describe('applyPaymentEvent', () => {
  it('CONFIRMED -> paid with paid_at, net and becamePaid', () => {
    expect(applyPaymentEvent(st(), 'PAYMENT_CONFIRMED', charge(), TODAY)).toEqual({
      status: 'paid', paid_at: '2027-01-14', net_amount_cents: 9500, becamePaid: true,
    })
  })
  it('RECEIVED -> paid (also from overdue)', () => {
    const p = applyPaymentEvent(st({ status: 'overdue' }), 'PAYMENT_RECEIVED', charge(), TODAY)
    expect(p?.status).toBe('paid')
    expect(p?.becamePaid).toBe(true)
  })
  it('OVERDUE only when pending', () => {
    expect(applyPaymentEvent(st(), 'PAYMENT_OVERDUE', charge(), TODAY)).toEqual({ status: 'overdue' })
    expect(applyPaymentEvent(st({ status: 'cancelled' }), 'PAYMENT_OVERDUE', charge(), TODAY)).toBeNull()
  })
  it('UPDATED changes due_date and amount when pending/overdue', () => {
    const p = applyPaymentEvent(st({ amount_cents: 10000 }), 'PAYMENT_UPDATED',
      charge({ dueDate: '2027-03-01', valueCents: 12000 }), TODAY)
    expect(p).toEqual({ due_date: '2027-03-01', amount_cents: 12000 })
  })
  it('UPDATED ignored when paid', () => {
    expect(applyPaymentEvent(st({ status: 'paid' }), 'PAYMENT_UPDATED', charge({ dueDate: '2027-03-01' }), TODAY)).toBeNull()
  })
  it('DELETED -> cancelled', () => {
    expect(applyPaymentEvent(st(), 'PAYMENT_DELETED', charge(), TODAY)).toEqual({ status: 'cancelled' })
  })
  it('DELETED does not cancel paid or refunded', () => {
    expect(applyPaymentEvent(st({ status: 'paid' }), 'PAYMENT_DELETED', charge(), TODAY)).toBeNull()
    expect(applyPaymentEvent(st({ status: 'refunded' }), 'PAYMENT_DELETED', charge(), TODAY)).toBeNull()
  })
  it('RESTORED only from cancelled and becomes overdue when past due', () => {
    expect(applyPaymentEvent(st({ status: 'cancelled' }), 'PAYMENT_RESTORED', charge(), TODAY)).toEqual({ status: 'pending' })
    expect(applyPaymentEvent(st({ status: 'cancelled', due_date: '2027-01-01' }), 'PAYMENT_RESTORED', charge(), TODAY)).toEqual({ status: 'overdue' })
    expect(applyPaymentEvent(st({ status: 'paid' }), 'PAYMENT_RESTORED', charge(), TODAY)).toBeNull()
  })
  it('REFUNDED -> refunded', () => {
    expect(applyPaymentEvent(st({ status: 'paid' }), 'PAYMENT_REFUNDED', charge(), TODAY)).toEqual({ status: 'refunded' })
  })
  it('REFUNDED with authorized invoice sets alert refunded_with_invoice', () => {
    const p = applyPaymentEvent(st({ status: 'paid', hasAuthorizedInvoice: true }), 'PAYMENT_REFUNDED', charge(), TODAY)
    expect(p).toMatchObject({ status: 'refunded', alert: 'refunded_with_invoice' })
  })
  it('RECEIVED_IN_CASH_UNDONE -> pending/overdue by due date, only if paid', () => {
    expect(applyPaymentEvent(st({ status: 'paid' }), 'PAYMENT_RECEIVED_IN_CASH_UNDONE', charge(), TODAY)?.status).toBe('pending')
    expect(applyPaymentEvent(st({ status: 'paid', due_date: '2027-01-01' }), 'PAYMENT_RECEIVED_IN_CASH_UNDONE', charge(), TODAY)?.status).toBe('overdue')
    expect(applyPaymentEvent(st(), 'PAYMENT_RECEIVED_IN_CASH_UNDONE', charge(), TODAY)).toBeNull()
  })
  it('CHARGEBACK_REQUESTED sets alert chargeback', () => {
    expect(applyPaymentEvent(st(), 'PAYMENT_CHARGEBACK_REQUESTED', charge(), TODAY)).toEqual({ alert: 'chargeback' })
  })
  it('late OVERDUE does not downgrade paid', () => {
    expect(applyPaymentEvent(st({ status: 'paid' }), 'PAYMENT_OVERDUE', charge(), TODAY)).toBeNull()
  })
  it('RECEIVED twice is idempotent (second returns null)', () => {
    const first = applyPaymentEvent(st(), 'PAYMENT_RECEIVED', charge(), TODAY)!
    const after = st({ status: 'paid', net_amount_cents: first.net_amount_cents, paid_at: first.paid_at })
    expect(applyPaymentEvent(after, 'PAYMENT_RECEIVED', charge(), TODAY)).toBeNull()
  })
  it('CONFIRMED then RECEIVED updates net_amount without becamePaid', () => {
    const p = applyPaymentEvent(st({ status: 'paid', net_amount_cents: null, paid_at: '2027-01-14' }), 'PAYMENT_RECEIVED', charge({ netValueCents: 9400 }), TODAY)
    expect(p).toEqual({ net_amount_cents: 9400 })
    expect(p?.becamePaid).toBeUndefined()
  })
  it('unknown event returns null', () => {
    expect(applyPaymentEvent(st(), 'PAYMENT_CREATED', charge(), TODAY)).toBeNull()
  })
})

describe('applyProviderStatus', () => {
  it('RECEIVED_IN_CASH -> paid', () => {
    expect(applyProviderStatus(st(), charge({ status: 'RECEIVED_IN_CASH' }), TODAY)?.status).toBe('paid')
  })
  it('deleted: true -> cancelled', () => {
    expect(applyProviderStatus(st(), charge({ status: 'PENDING', deleted: true }), TODAY)).toEqual({ status: 'cancelled' })
  })
  it('PENDING with local overdue and future due date -> pending', () => {
    const p = applyProviderStatus(st({ status: 'overdue', due_date: '2027-01-01', amount_cents: 10000 }), charge({ dueDate: '2027-02-01' }), TODAY)
    expect(p).toMatchObject({ status: 'pending', due_date: '2027-02-01' })
  })
  it('REFUNDED and CHARGEBACK_REQUESTED map to their events', () => {
    expect(applyProviderStatus(st({ status: 'paid' }), charge({ status: 'REFUNDED' }), TODAY)?.status).toBe('refunded')
    expect(applyProviderStatus(st(), charge({ status: 'CHARGEBACK_REQUESTED' }), TODAY)).toEqual({ alert: 'chargeback' })
  })
  it('unchanged PENDING returns null', () => {
    expect(applyProviderStatus(st({ amount_cents: 10000 }), charge(), TODAY)).toBeNull()
  })
  it('CONFIRMED -> paid', () => {
    expect(applyProviderStatus(st(), charge({ status: 'CONFIRMED' }), TODAY)?.status).toBe('paid')
  })
  it('PENDING with local paid returns null (never reopens paid)', () => {
    expect(applyProviderStatus(st({ status: 'paid' }), charge({ status: 'PENDING' }), TODAY)).toBeNull()
  })
  it('OVERDUE with local paid returns null', () => {
    expect(applyProviderStatus(st({ status: 'paid' }), charge({ status: 'OVERDUE' }), TODAY)).toBeNull()
  })
  it('PENDING/OVERDUE with local cancelled is restored using charge due date and amount', () => {
    const c = { dueDate: '2027-03-01', valueCents: 12000 }
    expect(applyProviderStatus(st({ status: 'cancelled' }), charge({ status: 'PENDING', ...c }), TODAY))
      .toEqual({ status: 'pending', due_date: '2027-03-01', amount_cents: 12000 })
    expect(applyProviderStatus(st({ status: 'cancelled' }), charge({ status: 'OVERDUE', ...c }), TODAY))
      .toEqual({ status: 'overdue', due_date: '2027-03-01', amount_cents: 12000 })
  })
})

describe('extra branches', () => {
  it('RECEIVED_IN_CASH event -> paid', () => {
    expect(applyPaymentEvent(st(), 'PAYMENT_RECEIVED_IN_CASH', charge(), TODAY)?.becamePaid).toBe(true)
  })
  it('paid row receiving RECEIVED with different paidAt patches paid_at without becamePaid', () => {
    const p = applyPaymentEvent(
      st({ status: 'paid', net_amount_cents: 9500, paid_at: '2027-01-13' }),
      'PAYMENT_RECEIVED', charge(), TODAY)
    expect(p).toEqual({ paid_at: '2027-01-14' })
  })
})
