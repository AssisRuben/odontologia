import { describe, expect, it, vi } from 'vitest'
import { createCharge, type ChargeDeps, type CreateChargeInput } from '@/lib/payments/charges'
import { PaymentProviderError, type ProviderCharge } from '@/lib/payments'

const NOW = new Date('2027-01-10T15:00:00Z')
const CPF = '52998224725'

function pc(n: number, total: number): ProviderCharge {
  return {
    id: `pay_${n}`, installmentId: total > 1 ? 'inst_1' : null, installmentNumber: total > 1 ? n : null,
    status: 'PENDING', deleted: false, valueCents: 1000, netValueCents: null, dueDate: `2027-0${n}-15`,
    paidAt: null, invoiceUrl: `https://asaas/i/${n}`, externalReference: null,
  }
}

function makeDeps(over: Partial<Record<keyof ChargeDeps, never>> = {}) {
  const provider = {
    ensureCustomer: vi.fn(async (...args: unknown[]) => (args.length >= 0 ? 'cus_1' : '')),
    createCharge: vi.fn(async (c: { installmentCount: number }) =>
      Array.from({ length: c.installmentCount }, (_, i) => pc(i + 1, c.installmentCount))),
  }
  const deps = {
    getPatient: vi.fn<ChargeDeps['getPatient']>(async () => ({
      id: 'p1', name: 'Ana', cpf: CPF, phone: '1133334444', whatsapp: '11987654321', email: 'a@x.com',
    })),
    budgetBelongsToPatient: vi.fn<ChargeDeps['budgetBelongsToPatient']>(async () => true),
    savePatientCpf: vi.fn<ChargeDeps['savePatientCpf']>(async () => {}),
    getConnection: vi.fn<ChargeDeps['getConnection']>(async () => ({
      provider: provider as never,
      connection: { status: 'connected', fine_percent: 2, interest_percent_month: 1 },
    })),
    getCustomerId: vi.fn<ChargeDeps['getCustomerId']>(async () => null),
    saveCustomerId: vi.fn<ChargeDeps['saveCustomerId']>(async () => {}),
    findRecentDuplicate: vi.fn<ChargeDeps['findRecentDuplicate']>(async () => false),
    insertCreatingRows: vi.fn<ChargeDeps['insertCreatingRows']>(async (rows) => rows.map((_, i) => `row${i + 1}`)),
    linkRows: vi.fn<ChargeDeps['linkRows']>(async () => {}),
    deleteRows: vi.fn<ChargeDeps['deleteRows']>(async () => {}),
    markInvalidKey: vi.fn<ChargeDeps['markInvalidKey']>(async () => {}),
    sendLink: vi.fn<ChargeDeps['sendLink']>(async () => ({ status: 200, body: { id: 'm1' } })),
    today: vi.fn<ChargeDeps['today']>(async () => '2027-01-10'),
    ...over,
  }
  return { deps: deps as typeof deps, provider }
}

const base: CreateChargeInput = {
  clinicId: 'c1', patientId: 'p1', amountCents: 10000, description: 'Tratamento', kind: 'carne',
  installmentCount: 10, firstDueDate: '2027-02-15', sendWhatsApp: false,
}

describe('createCharge', () => {
  it('creates 10 carne rows creating, calls provider with externalReference=groupId, links and activates', async () => {
    const { deps, provider } = makeDeps()
    const r = await createCharge(base, deps, NOW)
    expect(r.status).toBe(201)
    const rows = deps.insertCreatingRows.mock.calls[0][0]
    expect(rows).toHaveLength(10)
    expect(rows[0]).toMatchObject({
      clinicId: 'c1', patientId: 'p1', kind: 'carne', installmentNumber: 1, installmentCount: 10,
      amountCents: 1000, dueDate: '2027-02-15', description: 'Tratamento', paymentMethod: 'boleto',
    })
    const groupId = rows[0].groupId
    expect(provider.createCharge.mock.calls[0][0]).toMatchObject({
      customerId: 'cus_1', externalReference: groupId, totalCents: 10000, installmentCount: 10, finePercent: 2,
    })
    expect(deps.linkRows).toHaveBeenCalledWith('c1', groupId, expect.any(Array))
    const body = r.body as { groupId: string; paymentIds: string[]; pending?: true }
    expect(body.groupId).toBe(groupId)
    expect(body.paymentIds).toHaveLength(10)
    expect(body.pending).toBeUndefined()
  })

  it('avulsa is one row without installment fields', async () => {
    const { deps } = makeDeps()
    const r = await createCharge({ ...base, kind: 'avulsa', installmentCount: 1 }, deps, NOW)
    expect(r.status).toBe(201)
    const rows = deps.insertCreatingRows.mock.calls[0][0]
    expect(rows).toHaveLength(1)
    expect(rows[0].installmentNumber).toBeNull()
    expect(rows[0].installmentCount).toBeNull()
    expect(rows[0].paymentMethod).toBeNull()
  })

  it("missing CPF on patient and none given → 422 'Informe o CPF do paciente'", async () => {
    const { deps } = makeDeps()
    deps.getPatient.mockResolvedValue({ id: 'p1', name: 'Ana', cpf: null, phone: null, whatsapp: null, email: null })
    const r = await createCharge(base, deps, NOW)
    expect(r).toEqual({ status: 422, body: { error: 'Informe o CPF do paciente' } })
    expect(deps.insertCreatingRows).not.toHaveBeenCalled()
  })

  it('given CPF is saved to patient', async () => {
    const { deps, provider } = makeDeps()
    deps.getPatient.mockResolvedValue({ id: 'p1', name: 'Ana', cpf: null, phone: null, whatsapp: null, email: null })
    const r = await createCharge({ ...base, cpf: '529.982.247-25' }, deps, NOW)
    expect(r.status).toBe(201)
    expect(deps.savePatientCpf).toHaveBeenCalledWith('c1', 'p1', CPF)
    expect(provider.ensureCustomer.mock.calls[0][0]).toMatchObject({ cpf: CPF })
  })

  it("invalid CPF → 422 'CPF inválido'", async () => {
    const { deps } = makeDeps()
    const r = await createCharge({ ...base, cpf: '111.111.111-11' }, deps, NOW)
    expect(r).toEqual({ status: 422, body: { error: 'CPF inválido' } })
    expect(deps.savePatientCpf).not.toHaveBeenCalled()
  })

  it("no connection → 409 'Conecte o Asaas em Configurações → Pagamentos'", async () => {
    const { deps } = makeDeps()
    deps.getConnection.mockResolvedValue(null)
    const r = await createCharge(base, deps, NOW)
    expect(r).toEqual({ status: 409, body: { error: 'Conecte o Asaas em Configurações → Pagamentos' } })
  })

  it('invalid_key connection → 409 asaas_invalid_key', async () => {
    const { deps, provider } = makeDeps()
    deps.getConnection.mockResolvedValue({
      provider: provider as never, connection: { status: 'invalid_key', fine_percent: 2, interest_percent_month: 1 },
    })
    const r = await createCharge(base, deps, NOW)
    expect(r).toEqual({ status: 409, body: { error: 'asaas_invalid_key' } })
    expect(deps.insertCreatingRows).not.toHaveBeenCalled()
  })

  it('provider invalid_key during creation marks the connection and deletes rows', async () => {
    const { deps, provider } = makeDeps()
    provider.createCharge.mockRejectedValue(new PaymentProviderError('invalid_key', 'x'))
    const r = await createCharge(base, deps, NOW)
    expect(r).toEqual({ status: 409, body: { error: 'asaas_invalid_key' } })
    expect(deps.markInvalidKey).toHaveBeenCalledWith('c1')
    expect(deps.deleteRows).toHaveBeenCalled()
  })

  it('provider validation error deletes rows and returns 422 with message', async () => {
    const { deps, provider } = makeDeps()
    provider.createCharge.mockRejectedValue(new PaymentProviderError('validation', 'CPF recusado'))
    const r = await createCharge(base, deps, NOW)
    expect(r).toEqual({ status: 422, body: { error: 'CPF recusado' } })
    expect(deps.deleteRows).toHaveBeenCalledWith('c1', expect.any(String))
    expect(deps.linkRows).not.toHaveBeenCalled()
  })

  it("ensureCustomer unavailable deletes rows and returns 503 'Nada foi cobrado'", async () => {
    const { deps, provider } = makeDeps()
    provider.ensureCustomer.mockRejectedValue(new PaymentProviderError('unavailable', 'timeout'))
    const r = await createCharge(base, deps, NOW)
    expect(r).toEqual({
      status: 503,
      body: { error: 'Não foi possível gerar a cobrança agora. Nada foi cobrado do paciente. Tente novamente.' },
    })
    expect(deps.deleteRows).toHaveBeenCalled()
  })

  it('createCharge unavailable keeps rows creating and returns pending', async () => {
    const { deps, provider } = makeDeps()
    provider.createCharge.mockRejectedValue(new PaymentProviderError('unavailable', 'timeout'))
    const r = await createCharge({ ...base, sendWhatsApp: true }, deps, NOW)
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ pending: true, paymentIds: expect.any(Array) })
    expect(deps.deleteRows).not.toHaveBeenCalled()
    expect(deps.linkRows).not.toHaveBeenCalled()
    expect(deps.sendLink).not.toHaveBeenCalled()
  })

  it('passes the injected now to today()', async () => {
    const { deps } = makeDeps()
    await createCharge(base, deps, NOW)
    expect(deps.today).toHaveBeenCalledWith('c1', NOW)
  })

  it('leaves rows creating when linking fails after provider success', async () => {
    const { deps } = makeDeps()
    deps.linkRows.mockRejectedValue(new Error('db'))
    const r = await createCharge({ ...base, sendWhatsApp: true }, deps, NOW)
    expect(r.status).toBe(201)
    expect((r.body as { pending?: boolean }).pending).toBe(true)
    expect(deps.deleteRows).not.toHaveBeenCalled()
    expect(deps.sendLink).not.toHaveBeenCalled()
  })

  it("duplicate within 30s → 409 'Cobrança igual criada há instantes'", async () => {
    const { deps } = makeDeps()
    deps.findRecentDuplicate.mockResolvedValue(true)
    const r = await createCharge(base, deps, NOW)
    expect(r).toEqual({ status: 409, body: { error: 'Cobrança igual criada há instantes' } })
    expect(deps.findRecentDuplicate).toHaveBeenCalledWith('c1', 'p1', 10000, 'Tratamento', new Date(NOW.getTime() - 30_000))
    expect(deps.insertCreatingRows).not.toHaveBeenCalled()
  })

  it('sendWhatsApp sends link of first installment only', async () => {
    const { deps } = makeDeps()
    const r = await createCharge({ ...base, sendWhatsApp: true }, deps, NOW)
    expect(deps.sendLink).toHaveBeenCalledTimes(1)
    expect(deps.sendLink).toHaveBeenCalledWith('c1', 'row1')
    expect((r.body as { whatsapp?: unknown }).whatsapp).toEqual({ ok: true })
  })

  it('whatsapp failure does not fail the charge', async () => {
    const { deps } = makeDeps()
    deps.sendLink.mockResolvedValue({ status: 422, body: { error: 'Paciente optou por não receber' } })
    const r = await createCharge({ ...base, sendWhatsApp: true }, deps, NOW)
    expect(r.status).toBe(201)
    expect((r.body as { whatsapp?: unknown }).whatsapp).toEqual({ ok: false, error: 'Paciente optou por não receber' })
    deps.sendLink.mockRejectedValue(new Error('boom'))
    const r2 = await createCharge({ ...base, sendWhatsApp: true }, deps, NOW)
    expect(r2.status).toBe(201)
  })

  it('budgetId is stored on every row', async () => {
    const { deps } = makeDeps()
    await createCharge({ ...base, budgetId: 'b1' }, deps, NOW)
    const rows = deps.insertCreatingRows.mock.calls[0][0]
    expect(rows.every((x) => x.budgetId === 'b1')).toBe(true)
  })

  it("patient or budget of another clinic → 404 'Paciente não encontrado'", async () => {
    const { deps } = makeDeps()
    deps.getPatient.mockResolvedValue(null)
    expect(await createCharge(base, deps, NOW)).toEqual({ status: 404, body: { error: 'Paciente não encontrado' } })
    const { deps: d2 } = makeDeps()
    d2.budgetBelongsToPatient.mockResolvedValue(false)
    expect(await createCharge({ ...base, budgetId: 'b9' }, d2, NOW)).toEqual({
      status: 404, body: { error: 'Paciente não encontrado' },
    })
  })

  it('rejects impossible calendar dates and past dates', async () => {
    const { deps } = makeDeps()
    expect(await createCharge({ ...base, firstDueDate: '2027-02-31' }, deps, NOW)).toEqual({
      status: 422, body: { error: 'Data de vencimento inválida' },
    })
    expect((await createCharge({ ...base, firstDueDate: '2027-01-01' }, deps, NOW)).status).toBe(422)
  })

  it('uses cached customer id without calling ensureCustomer', async () => {
    const { deps, provider } = makeDeps()
    deps.getCustomerId.mockResolvedValue('cus_cached')
    await createCharge(base, deps, NOW)
    expect(provider.ensureCustomer).not.toHaveBeenCalled()
    expect(provider.createCharge.mock.calls[0][0]).toMatchObject({ customerId: 'cus_cached' })
  })
})
