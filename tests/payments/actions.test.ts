import { describe, expect, it, vi } from 'vitest'
import { cancelPayment, changeDueDate, markReceived, type ActionDeps, type ActionPayment } from '@/lib/payments/actions'
import { PaymentProviderError, type ProviderCharge } from '@/lib/payments'

const NOW = new Date('2027-01-10T15:00:00Z')

const base: ActionPayment = {
  id: 'p1', status: 'pending', dueDate: '2027-01-20', amountCents: 10000, paidAt: null, netAmountCents: null,
  providerChargeId: 'pay_1', providerInstallmentId: null, providerState: 'active', chargeGroupId: 'g1', chargeKind: 'avulsa',
  hasAuthorizedInvoice: false,
}

function charge(over: Partial<ProviderCharge> = {}): ProviderCharge {
  return {
    id: 'pay_1', installmentId: null, installmentNumber: null, status: 'PENDING', deleted: false, valueCents: 10000,
    netValueCents: null, dueDate: '2027-02-01', paidAt: null, invoiceUrl: null, externalReference: null, ...over,
  }
}

function makeDeps(payment: Partial<ActionPayment> | null = {}) {
  const provider = {
    updateDueDate: vi.fn(async () => charge()),
    receiveInCash: vi.fn(async () => {}),
    cancelCharge: vi.fn(async () => {}),
    cancelInstallment: vi.fn(async () => {}),
  }
  const deps = {
    getPayment: vi.fn<ActionDeps['getPayment']>(async () => (payment ? { ...base, ...payment } : null)),
    getConnection: vi.fn<ActionDeps['getConnection']>(async () => ({ provider: provider as never, connection: { nfse_auto: false } })),
    listUnpaidInGroup: vi.fn<ActionDeps['listUnpaidInGroup']>(async () => ['p1', 'p2', 'p3']),
    updateRows: vi.fn<ActionDeps['updateRows']>(async (_c, ids) => ids.length),
    markInvalidKey: vi.fn<ActionDeps['markInvalidKey']>(async () => {}),
    today: vi.fn<ActionDeps['today']>(async () => '2027-01-10'),
    scheduleInvoice: vi.fn<ActionDeps['scheduleInvoice']>(async () => {}),
  }
  return { deps, provider }
}

describe('changeDueDate', () => {
  it('only for pending/overdue', async () => {
    const { deps } = makeDeps({ status: 'paid' })
    const r = await changeDueDate('c1', 'p1', '2027-02-01', deps, NOW)
    expect(r).toEqual({ status: 409, body: { error: 'Só é possível alterar cobranças em aberto' } })
  })
  it('in the past is 422', async () => {
    const { deps, provider } = makeDeps()
    const r = await changeDueDate('c1', 'p1', '2027-01-09', deps, NOW)
    expect(r.status).toBe(422)
    expect(provider.updateDueDate).not.toHaveBeenCalled()
  })
  it('on Asaas calls the provider and saves date as pending', async () => {
    const { deps, provider } = makeDeps({ status: 'overdue' })
    const r = await changeDueDate('c1', 'p1', '2027-02-01', deps, NOW)
    expect(r.status).toBe(200)
    expect(provider.updateDueDate).toHaveBeenCalledWith('pay_1', '2027-02-01')
    expect(deps.updateRows).toHaveBeenCalledWith('c1', ['p1'], { due_date: '2027-02-01', status: 'pending' })
  })
  it('manual only saves', async () => {
    const { deps, provider } = makeDeps({ providerChargeId: null, providerState: null })
    expect((await changeDueDate('c1', 'p1', '2027-02-01', deps, NOW)).status).toBe(200)
    expect(provider.updateDueDate).not.toHaveBeenCalled()
    expect(deps.updateRows).toHaveBeenCalled()
  })
})

describe('markReceived', () => {
  it('on Asaas calls receiveInCash and marks paid', async () => {
    const { deps, provider } = makeDeps()
    const r = await markReceived('c1', 'p1', { paidAt: '2027-01-10', amountCents: 10000, method: 'pix' }, deps, NOW)
    expect(r.status).toBe(200)
    expect(provider.receiveInCash).toHaveBeenCalledWith('pay_1', '2027-01-10', 10000)
    expect(deps.updateRows).toHaveBeenCalledWith('c1', ['p1'], { status: 'paid', paid_at: '2027-01-10', payment_method: 'pix' })
  })
  it('manual just updates', async () => {
    const { deps, provider } = makeDeps({ providerChargeId: null, providerState: null })
    const r = await markReceived('c1', 'p1', { paidAt: '2027-01-09', amountCents: 10000 }, deps, NOW)
    expect(r.status).toBe(200)
    expect(provider.receiveInCash).not.toHaveBeenCalled()
    expect(deps.updateRows).toHaveBeenCalledWith('c1', ['p1'], { status: 'paid', paid_at: '2027-01-09' })
  })
  it('rejects future date, bad amount and non-open', async () => {
    const { deps } = makeDeps()
    expect(await markReceived('c1', 'p1', { paidAt: '2027-01-11', amountCents: 100 }, deps, NOW))
      .toEqual({ status: 422, body: { error: 'Data de pagamento inválida' } })
    expect((await markReceived('c1', 'p1', { paidAt: '2027-01-10', amountCents: 0 }, deps, NOW)).status).toBe(422)
    const { deps: d2 } = makeDeps({ status: 'cancelled' })
    expect(await markReceived('c1', 'p1', { paidAt: '2027-01-10', amountCents: 100 }, d2, NOW))
      .toEqual({ status: 409, body: { error: 'Este lançamento não está em aberto' } })
  })
  it('markReceived on Asaas row with nfse_auto schedules invoice', async () => {
    const { deps, provider } = makeDeps()
    deps.getConnection.mockResolvedValue({ provider: provider as never, connection: { nfse_auto: true } })
    const r = await markReceived('c1', 'p1', { paidAt: '2027-01-10', amountCents: 10000 }, deps, NOW)
    expect(r.status).toBe(200)
    expect(deps.scheduleInvoice).toHaveBeenCalledWith('c1', 'p1')
    expect(deps.updateRows.mock.invocationCallOrder[0]).toBeLessThan(deps.scheduleInvoice.mock.invocationCallOrder[0])
  })
  it('markReceived on Asaas row without nfse_auto does not schedule invoice', async () => {
    const { deps } = makeDeps()
    expect((await markReceived('c1', 'p1', { paidAt: '2027-01-10', amountCents: 10000 }, deps, NOW)).status).toBe(200)
    expect(deps.scheduleInvoice).not.toHaveBeenCalled()
  })
  it('markReceived: invoice failure is logged and the receipt still succeeds', async () => {
    const { deps, provider } = makeDeps()
    deps.getConnection.mockResolvedValue({ provider: provider as never, connection: { nfse_auto: true } })
    deps.scheduleInvoice.mockRejectedValue(new Error('Configure a alíquota do ISS'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await markReceived('c1', 'p1', { paidAt: '2027-01-10', amountCents: 10000 }, deps, NOW)
    expect(r).toEqual({ status: 200, body: { ok: true, ids: ['p1'] } })
    expect(err).toHaveBeenCalledWith(expect.any(String), 'Configure a alíquota do ISS')
    err.mockRestore()
  })
  it('markReceived: no invoice when the row did not change or is manual', async () => {
    const { deps, provider } = makeDeps()
    deps.getConnection.mockResolvedValue({ provider: provider as never, connection: { nfse_auto: true } })
    deps.updateRows.mockResolvedValue(0)
    expect((await markReceived('c1', 'p1', { paidAt: '2027-01-10', amountCents: 10000 }, deps, NOW)).status).toBe(409)
    const { deps: d2 } = makeDeps({ providerChargeId: null, providerState: null, chargeKind: 'manual' })
    d2.getConnection.mockResolvedValue({ provider: provider as never, connection: { nfse_auto: true } })
    expect((await markReceived('c1', 'p1', { paidAt: '2027-01-10', amountCents: 10000 }, d2, NOW)).status).toBe(200)
    expect(deps.scheduleInvoice).not.toHaveBeenCalled()
    expect(d2.scheduleInvoice).not.toHaveBeenCalled()
  })
})

describe('cancelPayment', () => {
  it('cancel paid is 409', async () => {
    const { deps } = makeDeps({ status: 'paid' })
    expect(await cancelPayment('c1', 'p1', 'one', deps)).toEqual({
      status: 409,
      body: { error: 'Pagamento recebido não pode ser cancelado. Faça o estorno no painel do Asaas.' },
    })
  })
  it('one calls cancelCharge', async () => {
    const { deps, provider } = makeDeps({ providerInstallmentId: 'inst_1' })
    await cancelPayment('c1', 'p1', 'one', deps)
    expect(provider.cancelCharge).toHaveBeenCalledWith('pay_1')
    expect(deps.updateRows).toHaveBeenCalledWith('c1', ['p1'], { status: 'cancelled' })
  })
  it('remaining calls cancelInstallment and cancels only unpaid rows of the group', async () => {
    const { deps, provider } = makeDeps({ providerInstallmentId: 'inst_1' })
    const r = await cancelPayment('c1', 'p1', 'remaining', deps)
    expect(provider.cancelInstallment).toHaveBeenCalledWith('inst_1')
    expect(deps.listUnpaidInGroup).toHaveBeenCalledWith('c1', 'g1')
    expect(deps.updateRows).toHaveBeenCalledWith('c1', ['p1', 'p2', 'p3'], { status: 'cancelled' })
    expect(r.status).toBe(200)
  })
  it('remaining on a single Asaas payment behaves like one', async () => {
    const { deps, provider } = makeDeps({ chargeGroupId: null })
    await cancelPayment('c1', 'p1', 'remaining', deps)
    expect(provider.cancelCharge).toHaveBeenCalled()
    expect(deps.listUnpaidInGroup).not.toHaveBeenCalled()
    expect(deps.updateRows).toHaveBeenCalledWith('c1', ['p1'], { status: 'cancelled' })
  })
  it('manual group remaining only updates rows', async () => {
    const { deps, provider } = makeDeps({ providerChargeId: null, providerState: null })
    await cancelPayment('c1', 'p1', 'remaining', deps)
    expect(provider.cancelCharge).not.toHaveBeenCalled()
    expect(deps.updateRows).toHaveBeenCalledWith('c1', ['p1', 'p2', 'p3'], { status: 'cancelled' })
  })
})

describe('review fixes', () => {
  it('remaining without installment id cancels only this row', async () => {
    const { deps, provider } = makeDeps()
    await cancelPayment('c1', 'p1', 'remaining', deps)
    expect(provider.cancelCharge).toHaveBeenCalledWith('pay_1')
    expect(deps.listUnpaidInGroup).not.toHaveBeenCalled()
    expect(deps.updateRows).toHaveBeenCalledWith('c1', ['p1'], { status: 'cancelled' })
  })
  it('card installment cannot be received in cash', async () => {
    const { deps, provider } = makeDeps({ chargeKind: 'cartao_parcelado' })
    const r = await markReceived('c1', 'p1', { paidAt: '2027-01-10', amountCents: 100 }, deps, NOW)
    expect(r).toEqual({ status: 409, body: { error: 'Pagamento no cartão não pode ser marcado como recebido em dinheiro' } })
    expect(provider.receiveInCash).not.toHaveBeenCalled()
  })
  it('zero rows updated → 409', async () => {
    const { deps } = makeDeps()
    deps.updateRows.mockResolvedValue(0)
    expect((await cancelPayment('c1', 'p1', 'one', deps)).status).toBe(409)
  })
})

describe('common', () => {
  it('other clinic payment → 404', async () => {
    const { deps } = makeDeps(null)
    for (const r of [
      await changeDueDate('c2', 'p1', '2027-02-01', deps, NOW),
      await markReceived('c2', 'p1', { paidAt: '2027-01-10', amountCents: 1 }, deps, NOW),
      await cancelPayment('c2', 'p1', 'one', deps),
    ]) expect(r).toEqual({ status: 404, body: { error: 'Pagamento não encontrado' } })
  })
  it('creating rows → 409', async () => {
    const { deps } = makeDeps({ providerState: 'creating' })
    const msg = { error: 'Cobrança ainda sendo criada. Aguarde alguns minutos.' }
    expect(await cancelPayment('c1', 'p1', 'one', deps)).toEqual({ status: 409, body: msg })
    expect(await changeDueDate('c1', 'p1', '2027-02-01', deps, NOW)).toEqual({ status: 409, body: msg })
    expect(await markReceived('c1', 'p1', { paidAt: '2027-01-10', amountCents: 1 }, deps, NOW)).toEqual({ status: 409, body: msg })
  })
  it('invalid_key flags connection and writes nothing', async () => {
    const { deps, provider } = makeDeps()
    provider.cancelCharge.mockRejectedValue(new PaymentProviderError('invalid_key', 'x'))
    const r = await cancelPayment('c1', 'p1', 'one', deps)
    expect(r).toEqual({ status: 409, body: { error: 'asaas_invalid_key' } })
    expect(deps.markInvalidKey).toHaveBeenCalledWith('c1')
    expect(deps.updateRows).not.toHaveBeenCalled()
  })
})
