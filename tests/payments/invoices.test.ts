import { describe, expect, it, vi } from 'vitest'
import { cancelInvoice, scheduleInvoiceForPayment, type InvoiceDeps, type InvoicePayment } from '@/lib/payments/invoices'
import { PaymentProviderError } from '@/lib/payments'

const base: InvoicePayment = {
  id: 'p1', patientId: 'pt1', status: 'paid', description: 'Limpeza', amountCents: 10000, chargeKind: 'avulsa',
  chargeGroupId: 'g1', installmentNumber: null, providerChargeId: 'pay_1', providerInstallmentId: null,
  providerState: 'active',
}

function makeDeps(payment: Partial<InvoicePayment> | null = {}, over: { group?: InvoicePayment[]; iss?: number | null } = {}) {
  const provider = {
    scheduleInvoice: vi.fn(async (_i: unknown) => ({
      id: 'inv_1', status: 'SCHEDULED', number: null, pdfUrl: null, xmlUrl: null, error: null, externalReference: 'p1',
    })),
    cancelInvoice: vi.fn(async (_id: string) => {}),
    ensureCustomer: vi.fn(async (_c: unknown) => 'cus_1'),
  }
  const deps = {
    getPayment: vi.fn<InvoiceDeps['getPayment']>(async (_c, id) => (payment ? { ...base, id, ...payment } : null)),
    listGroup: vi.fn<InvoiceDeps['listGroup']>(async () => over.group ?? []),
    hasActiveInvoice: vi.fn<InvoiceDeps['hasActiveInvoice']>(async () => false),
    getConnection: vi.fn<InvoiceDeps['getConnection']>(async () => ({
      provider: provider as never,
      connection: {
        status: 'connected',
        nfse_description: 'Serviços odontológicos - {descricao}',
        nfse_service_code: '4.02',
        nfse_iss_rate: over.iss === undefined ? 2 : over.iss,
      } as never,
    })),
    getPatient: vi.fn<InvoiceDeps['getPatient']>(async () => ({
      id: 'pt1', name: 'Ana', cpf: '52998224725', phone: null, whatsapp: null, email: null,
    })),
    getCustomerId: vi.fn<InvoiceDeps['getCustomerId']>(async () => null),
    saveCustomerId: vi.fn<InvoiceDeps['saveCustomerId']>(async () => {}),
    insertInvoice: vi.fn<InvoiceDeps['insertInvoice']>(async () => ({ id: 'fi1' })),
    getInvoice: vi.fn<InvoiceDeps['getInvoice']>(async () => ({ id: 'fi1', providerInvoiceId: 'inv_1', status: 'authorized' })),
    markCancelling: vi.fn<InvoiceDeps['markCancelling']>(async () => true),
    markInvalidKey: vi.fn<InvoiceDeps['markInvalidKey']>(async () => {}),
  }
  return { deps, provider }
}

describe('scheduleInvoiceForPayment', () => {
  it('schedules for a paid Asaas charge and stores a scheduled row', async () => {
    const { deps, provider } = makeDeps()
    const r = await scheduleInvoiceForPayment('c1', 'p1', {}, deps)
    expect(r.status).toBe(200)
    expect(provider.scheduleInvoice).toHaveBeenCalledWith({
      chargeId: 'pay_1', valueCents: 10000, description: 'Serviços odontológicos - Limpeza',
      serviceCode: '4.02', issRate: 2, externalReference: 'p1',
    })
    expect(deps.insertInvoice).toHaveBeenCalledWith({
      clinicId: 'c1', paymentId: 'p1', providerInvoiceId: 'inv_1', status: 'scheduled', valueCents: 10000,
      description: 'Serviços odontológicos - Limpeza',
    })
  })
  it("rejects unpaid → 409 'A nota só pode ser emitida para pagamentos recebidos'", async () => {
    const { deps, provider } = makeDeps({ status: 'pending' })
    const r = await scheduleInvoiceForPayment('c1', 'p1', {}, deps)
    expect(r).toEqual({ status: 409, body: { error: 'A nota só pode ser emitida para pagamentos recebidos' } })
    expect(provider.scheduleInvoice).not.toHaveBeenCalled()
  })
  it('rejects when active invoice exists', async () => {
    const { deps, provider } = makeDeps()
    deps.hasActiveInvoice.mockResolvedValue(true)
    const r = await scheduleInvoiceForPayment('c1', 'p1', {}, deps)
    expect(r).toEqual({ status: 409, body: { error: 'Já existe uma nota ativa para este pagamento' } })
    expect(provider.scheduleInvoice).not.toHaveBeenCalled()
  })
  it('unique violation after provider call cancels the provider invoice and returns 409', async () => {
    const { deps, provider } = makeDeps()
    deps.insertInvoice.mockResolvedValue(null)
    const r = await scheduleInvoiceForPayment('c1', 'p1', {}, deps)
    expect(r.status).toBe(409)
    expect(provider.cancelInvoice).toHaveBeenCalledWith('inv_1')
  })
  it('retry after error creates a new row and keeps the old', async () => {
    // hasActiveInvoice só conta scheduled/authorized/cancelling: uma nota antiga em 'error' não bloqueia
    const { deps } = makeDeps()
    const r = await scheduleInvoiceForPayment('c1', 'p1', {}, deps)
    expect(r.status).toBe(200)
    expect(deps.insertInvoice).toHaveBeenCalledTimes(1)
    expect(deps.hasActiveInvoice).toHaveBeenCalledWith('c1', ['p1'])
  })
  it('manual payment uses ensureCustomer with the patient CPF', async () => {
    const { deps, provider } = makeDeps({ chargeKind: 'manual', providerChargeId: null, providerState: null, chargeGroupId: null })
    const r = await scheduleInvoiceForPayment('c1', 'p1', {}, deps)
    expect(r.status).toBe(200)
    expect(provider.ensureCustomer).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'pt1', cpf: '52998224725' }))
    expect(provider.scheduleInvoice).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_1', chargeId: undefined }))
  })
  it("manual payment without CPF → 422 'Informe o CPF do paciente'", async () => {
    const { deps } = makeDeps({ chargeKind: 'manual', providerChargeId: null, providerState: null })
    deps.getPatient.mockResolvedValue({ id: 'pt1', name: 'Ana', cpf: null, phone: null, whatsapp: null, email: null })
    const r = await scheduleInvoiceForPayment('c1', 'p1', {}, deps)
    expect(r).toEqual({ status: 422, body: { error: 'Informe o CPF do paciente' } })
  })
  it('card group: invoice goes on installment 1 with the installment id and total', async () => {
    const mk = (id: string, n: number, over: Partial<InvoicePayment> = {}): InvoicePayment => ({
      ...base, id, chargeKind: 'cartao_parcelado', installmentNumber: n, amountCents: 5000,
      providerChargeId: `pay_${n}`, providerInstallmentId: 'ins_1', ...over,
    })
    const group = [mk('p1', 1), mk('p2', 2), mk('p3', 3, { amountCents: 5001 })]
    const { deps, provider } = makeDeps({ ...group[1] }, { group })
    const r = await scheduleInvoiceForPayment('c1', 'p2', {}, deps)
    expect(r.status).toBe(200)
    expect(provider.scheduleInvoice).toHaveBeenCalledWith(expect.objectContaining({
      installmentId: 'ins_1', chargeId: undefined, valueCents: 15001, externalReference: 'p1',
    }))
    expect(deps.insertInvoice).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'p1', valueCents: 15001 }))
  })
  it('opts override description and value', async () => {
    const { deps, provider } = makeDeps()
    await scheduleInvoiceForPayment('c1', 'p1', { description: 'Outra', valueCents: 9000 }, deps)
    expect(provider.scheduleInvoice).toHaveBeenCalledWith(expect.objectContaining({ description: 'Outra', valueCents: 9000 }))
  })
  it('null ISS rate → 409', async () => {
    const { deps } = makeDeps({}, { iss: null })
    const r = await scheduleInvoiceForPayment('c1', 'p1', {}, deps)
    expect(r).toEqual({ status: 409, body: { error: 'Configure a alíquota do ISS em Configurações → Pagamentos' } })
  })
  it("fiscal not configured → 409 'Configure a nota fiscal no painel do Asaas'", async () => {
    const { deps, provider } = makeDeps()
    provider.scheduleInvoice.mockRejectedValue(new PaymentProviderError('validation', 'x', 'invalid_fiscal_info'))
    const r = await scheduleInvoiceForPayment('c1', 'p1', {}, deps)
    expect(r).toEqual({ status: 409, body: { error: 'Configure a nota fiscal no painel do Asaas' } })
    expect(deps.insertInvoice).not.toHaveBeenCalled()
  })
  it('invalid key marks the connection', async () => {
    const { deps, provider } = makeDeps()
    provider.scheduleInvoice.mockRejectedValue(new PaymentProviderError('invalid_key', 'x'))
    const r = await scheduleInvoiceForPayment('c1', 'p1', {}, deps)
    expect(r).toEqual({ status: 409, body: { error: 'asaas_invalid_key' } })
    expect(deps.markInvalidKey).toHaveBeenCalledWith('c1')
  })
  it('unknown payment → 404', async () => {
    const { deps } = makeDeps(null)
    expect((await scheduleInvoiceForPayment('c1', 'p1', {}, deps)).status).toBe(404)
  })
})

describe('cancelInvoice', () => {
  it('cancel only authorized', async () => {
    const { deps, provider } = makeDeps()
    deps.getInvoice.mockResolvedValue({ id: 'fi1', providerInvoiceId: 'inv_1', status: 'scheduled' })
    const r = await cancelInvoice('c1', 'fi1', deps)
    expect(r).toEqual({ status: 409, body: { error: 'Só é possível cancelar notas autorizadas' } })
    expect(provider.cancelInvoice).not.toHaveBeenCalled()
  })
  it('authorized → provider cancel and cancelling', async () => {
    const { deps, provider } = makeDeps()
    const r = await cancelInvoice('c1', 'fi1', deps)
    expect(r.status).toBe(200)
    expect(provider.cancelInvoice).toHaveBeenCalledWith('inv_1')
    expect(deps.markCancelling).toHaveBeenCalledWith('c1', 'fi1')
  })
  it('unknown invoice → 404', async () => {
    const { deps } = makeDeps()
    deps.getInvoice.mockResolvedValue(null)
    expect((await cancelInvoice('c1', 'fi1', deps)).status).toBe(404)
  })
})
