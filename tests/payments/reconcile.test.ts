import { describe, expect, it, vi } from 'vitest'
import { reconcileAll, type ReconcileDeps } from '@/lib/payments/reconcile'
import { PaymentProviderError, type PaymentProvider, type ProviderCharge } from '@/lib/payments'

const NOW = new Date('2027-01-10T15:00:00Z')
const FAR = new Date('2027-01-10T15:00:50Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const MIN = 60_000
const HOUR = 60 * MIN

function charge(over: Partial<ProviderCharge> = {}): ProviderCharge {
  return {
    id: 'pay_1', installmentId: null, installmentNumber: null, status: 'PENDING', deleted: false, valueCents: 10000,
    netValueCents: null, dueDate: '2027-02-01', paidAt: null, invoiceUrl: null, externalReference: 'g1', ...over,
  }
}

function makeDeps() {
  const provider = {
    listChargesByReference: vi.fn<PaymentProvider['listChargesByReference']>(async () => []),
    getCharge: vi.fn<PaymentProvider['getCharge']>(async () => charge()),
    getInvoice: vi.fn<PaymentProvider['getInvoice']>(async () => ({
      id: 'inv_1', status: 'AUTHORIZED', number: '123', pdfUrl: 'pdf', xmlUrl: 'xml', error: null, externalReference: null,
    })),
  }
  const events = {
    findPayment: vi.fn(async (...[, id]: [string, string]) => ({
      id: 'p1', providerChargeId: id, status: 'pending' as const, dueDate: '2027-02-01', amountCents: 10000, paidAt: null,
      netAmountCents: null, hasAuthorizedInvoice: false, chargeKind: 'avulsa' as const, chargeGroupId: 'g1', installmentNumber: null,
    })),
    updatePayment: vi.fn(async () => true),
    today: vi.fn(async () => '2027-01-10'),
    getNfseAuto: vi.fn(async () => false),
    updateInvoice: vi.fn(async () => true),
    listGroup: vi.fn(async () => []),
    hasInvoice: vi.fn(async () => false),
    scheduleInvoice: vi.fn(async () => {}),
    finishEvent: vi.fn(async () => {}),
  }
  const deps = {
    listConnectedClinics: vi.fn<ReconcileDeps['listConnectedClinics']>(async () => ['c1']),
    getConnection: vi.fn<ReconcileDeps['getConnection']>(async () => ({ provider: provider as never })),
    listCreatingGroups: vi.fn<ReconcileDeps['listCreatingGroups']>(async () => []),
    completeRows: vi.fn<ReconcileDeps['completeRows']>(async (_c, _g, charges) => charges.length),
    deleteRows: vi.fn<ReconcileDeps['deleteRows']>(async () => {}),
    listOpenChargeIds: vi.fn<ReconcileDeps['listOpenChargeIds']>(async () => []),
    listStaleInvoices: vi.fn<ReconcileDeps['listStaleInvoices']>(async () => []),
    listFailedEvents: vi.fn<ReconcileDeps['listFailedEvents']>(async () => []),
    purgeEvents: vi.fn<ReconcileDeps['purgeEvents']>(async () => 0),
    markInvalidKey: vi.fn<ReconcileDeps['markInvalidKey']>(async () => {}),
    events: events as never,
    clock: () => NOW.getTime(),
  }
  return { deps, provider, events }
}

const row = (id: string, n: number | null, chargeId: string | null = null, state: 'creating' | 'active' = 'creating') => ({
  id, installmentNumber: n, providerChargeId: chargeId, providerState: state,
})

describe('reconcileAll', () => {
  it('completes creating group by externalReference', async () => {
    const { deps, provider } = makeDeps()
    deps.listCreatingGroups.mockResolvedValue([{ groupId: 'g1', createdAt: ago(20 * MIN), rows: [row('p1', 1), row('p2', 2)] }])
    const cs = [charge({ id: 'a', installmentNumber: 1 }), charge({ id: 'b', installmentNumber: 2 })]
    provider.listChargesByReference.mockResolvedValue(cs)
    const r = await reconcileAll(deps, NOW, FAR)
    expect(provider.listChargesByReference).toHaveBeenCalledWith('g1')
    expect(deps.completeRows).toHaveBeenCalledWith('c1', 'g1', cs)
    expect(r.c1.completed).toBe(1)
    expect(deps.deleteRows).not.toHaveBeenCalled()
  })
  it('deletes creating rows older than 1h with no provider charge', async () => {
    const { deps } = makeDeps()
    deps.listCreatingGroups.mockResolvedValue([{ groupId: 'g1', createdAt: ago(2 * HOUR), rows: [row('p1', null)] }])
    const r = await reconcileAll(deps, NOW, FAR)
    expect(deps.deleteRows).toHaveBeenCalledWith('c1', 'g1')
    expect(r.c1.deleted).toBe(1)
  })
  it('keeps creating rows between 10 min and 1h when provider has nothing', async () => {
    const { deps } = makeDeps()
    deps.listCreatingGroups.mockResolvedValue([{ groupId: 'g1', createdAt: ago(30 * MIN), rows: [row('p1', null)] }])
    await reconcileAll(deps, NOW, FAR)
    expect(deps.deleteRows).not.toHaveBeenCalled()
  })
  it('keeps creating rows younger than 10 min untouched', async () => {
    const { deps, provider } = makeDeps()
    deps.listCreatingGroups.mockResolvedValue([{ groupId: 'g1', createdAt: ago(5 * MIN), rows: [row('p1', null)] }])
    await reconcileAll(deps, NOW, FAR)
    expect(provider.listChargesByReference).not.toHaveBeenCalled()
    expect(deps.completeRows).not.toHaveBeenCalled()
    expect(deps.deleteRows).not.toHaveBeenCalled()
  })
  it('never deletes a group that has a row with provider charge', async () => {
    const { deps } = makeDeps()
    deps.listCreatingGroups.mockResolvedValue([
      { groupId: 'g1', createdAt: ago(2 * HOUR), rows: [row('p1', 1, 'pay_1', 'active'), row('p2', 2)] },
    ])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await reconcileAll(deps, NOW, FAR)
    expect(deps.deleteRows).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
  it('mixed group: count mismatch leaves rows alone and warns once', async () => {
    const { deps, provider } = makeDeps()
    deps.listCreatingGroups.mockResolvedValue([
      { groupId: 'g1', createdAt: ago(2 * HOUR), rows: [row('p1', 1, 'pay_1', 'active'), row('p2', 2), row('p3', 3)] },
    ])
    provider.listChargesByReference.mockResolvedValue([charge({ installmentNumber: 1 })])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await reconcileAll(deps, NOW, FAR)
    expect(deps.completeRows).not.toHaveBeenCalled()
    expect(deps.deleteRows).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(r.c1.completed).toBe(0)
    warn.mockRestore()
  })
  it('updates pending to paid from provider status', async () => {
    const { deps, provider, events } = makeDeps()
    deps.listOpenChargeIds.mockResolvedValue(['pay_1'])
    provider.getCharge.mockResolvedValue(charge({ status: 'RECEIVED', paidAt: '2027-01-09', netValueCents: 9800 }))
    const r = await reconcileAll(deps, NOW, FAR)
    expect(events.updatePayment).toHaveBeenCalledWith(
      'c1', 'p1', expect.objectContaining({ status: 'paid', paid_at: '2027-01-09', net_amount_cents: 9800 }), 'pending',
    )
    expect(r.c1.updated).toBe(1)
  })
  it('does not count a payment when nothing changes or CAS loses', async () => {
    const { deps, provider, events } = makeDeps()
    deps.listOpenChargeIds.mockResolvedValue(['pay_1', 'pay_2'])
    provider.getCharge.mockResolvedValueOnce(charge()).mockResolvedValueOnce(charge({ status: 'RECEIVED', paidAt: '2027-01-09' }))
    events.updatePayment.mockResolvedValue(false)
    const r = await reconcileAll(deps, NOW, FAR)
    expect(r.c1.updated).toBe(0)
  })
  it('refreshes scheduled invoices older than 1h', async () => {
    const { deps, events } = makeDeps()
    deps.listStaleInvoices.mockResolvedValue([{ providerInvoiceId: 'inv_1', status: 'scheduled' }])
    const r = await reconcileAll(deps, NOW, FAR)
    expect(deps.listStaleInvoices).toHaveBeenCalledWith('c1', ago(HOUR), expect.any(Function))
    expect(events.updateInvoice).toHaveBeenCalledWith(
      'c1', 'inv_1', expect.objectContaining({ status: 'authorized', number: '123' }), ['scheduled', 'error'],
    )
    expect(r.c1.invoices).toBe(1)
  })
  it('reprocesses failed events', async () => {
    const { deps } = makeDeps()
    deps.listFailedEvents.mockResolvedValue([
      { id: 'e1', clinic_id: 'c1', payload: { id: 'evt1', event: 'INVOICE_AUTHORIZED', invoice: { id: 'inv_1', status: 'AUTHORIZED' } } },
      { id: 'e2', clinic_id: 'c1', payload: { not: 'a webhook' } },
    ])
    const r = await reconcileAll(deps, NOW, FAR)
    expect(deps.listFailedEvents).toHaveBeenCalledWith('c1', ago(5 * MIN), ago(7 * 24 * HOUR), expect.any(Function))
    expect(r.c1.reprocessed).toBe(1)
  })
  it('purges processed events older than 90 days', async () => {
    const { deps } = makeDeps()
    await reconcileAll(deps, NOW, FAR)
    expect(deps.purgeEvents).toHaveBeenCalledWith('c1', ago(90 * 24 * HOUR))
  })
  it('marks invalid_key and continues with next clinic', async () => {
    const { deps, provider } = makeDeps()
    deps.listConnectedClinics.mockResolvedValue(['c1', 'c2'])
    deps.listOpenChargeIds.mockImplementation(async (c) => (c === 'c1' ? ['pay_1'] : []))
    provider.getCharge.mockRejectedValue(new PaymentProviderError('invalid_key', 'x'))
    const r = await reconcileAll(deps, NOW, FAR)
    expect(deps.markInvalidKey).toHaveBeenCalledWith('c1')
    expect(r.c1.error).toBe('asaas_invalid_key')
    expect(r.c2.error).toBeUndefined()
    expect(deps.purgeEvents).toHaveBeenCalledWith('c2', expect.anything())
  })
  it('one clinic failing does not stop the others', async () => {
    const { deps } = makeDeps()
    deps.listConnectedClinics.mockResolvedValue(['c1', 'c2'])
    deps.getConnection.mockRejectedValueOnce(new Error('boom'))
    const r = await reconcileAll(deps, NOW, FAR)
    expect(r.c1.error).toBe('boom')
    expect(r.c2.error).toBeUndefined()
  })
  it('stops before deadline', async () => {
    const { deps } = makeDeps()
    deps.listConnectedClinics.mockResolvedValue(['c1', 'c2'])
    const r = await reconcileAll(deps, NOW, new Date(NOW.getTime() - 1))
    expect(r).toEqual({})
    expect(deps.getConnection).not.toHaveBeenCalled()
  })
  it('scheduled invoice cancelled in Asaas becomes cancelled', async () => {
    const { deps, provider, events } = makeDeps()
    deps.listStaleInvoices.mockResolvedValue([{ providerInvoiceId: 'inv_1', status: 'scheduled' }])
    provider.getInvoice.mockResolvedValue({
      id: 'inv_1', status: 'CANCELED', number: null, pdfUrl: null, xmlUrl: null, error: null, externalReference: null,
    })
    const r = await reconcileAll(deps, NOW, FAR)
    expect(events.updateInvoice).toHaveBeenCalledWith(
      'c1', 'inv_1', { status: 'cancelled' }, ['scheduled', 'cancelling', 'authorized'],
    )
    expect(r.c1.invoices).toBe(1)
  })
  it('slow clinic does not starve the next clinic', async () => {
    const { deps, provider } = makeDeps()
    let t = NOW.getTime()
    deps.clock = () => t
    deps.listConnectedClinics.mockResolvedValue(['c1', 'c2'])
    deps.listOpenChargeIds.mockImplementation(async (c) => (c === 'c1' ? ['a', 'b', 'c', 'd'] : ['z']))
    provider.getCharge.mockImplementation(async () => {
      t += 20_000 // cada chamada lenta consome 20 s
      return charge()
    })
    const deadline = new Date(NOW.getTime() + 50_000)
    await reconcileAll(deps, NOW, deadline)
    // c1 tem 25 s de fatia: faz 2 chamadas (40 s) e para; c2 ainda roda com o que restou
    expect(provider.getCharge.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'z'])
  })
  it('scope creating only reconciles creating groups', async () => {
    const { deps, provider } = makeDeps()
    deps.listCreatingGroups.mockResolvedValue([{ groupId: 'g1', createdAt: ago(20 * MIN), rows: [row('p1', null)] }])
    provider.listChargesByReference.mockResolvedValue([charge()])
    deps.listOpenChargeIds.mockResolvedValue(['pay_1'])
    const r = await reconcileAll(deps, NOW, FAR, { scope: 'creating' })
    expect(r.c1.completed).toBe(1)
    expect(deps.listOpenChargeIds).not.toHaveBeenCalled()
    expect(provider.getCharge).not.toHaveBeenCalled()
    expect(deps.listStaleInvoices).not.toHaveBeenCalled()
    expect(deps.listFailedEvents).not.toHaveBeenCalled()
    expect(deps.purgeEvents).not.toHaveBeenCalled()
  })
  it('passes the clinic deadline to the paged lists', async () => {
    const { deps } = makeDeps()
    let t = NOW.getTime()
    deps.clock = () => t
    await reconcileAll(deps, NOW, FAR)
    for (const fn of [deps.listCreatingGroups, deps.listOpenChargeIds, deps.listStaleInvoices, deps.listFailedEvents]) {
      const alive = fn.mock.calls[0].at(-1) as () => boolean
      expect(typeof alive).toBe('function')
    }
    const alive = deps.listOpenChargeIds.mock.calls[0][1] as unknown as () => boolean
    expect(alive()).toBe(true)
    t = FAR.getTime()
    expect(alive()).toBe(false)
  })
})
