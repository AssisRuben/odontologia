import { afterEach, describe, expect, it, vi } from 'vitest'
import { AsaasProvider, ASAAS_WEBHOOK_EVENTS } from '@/lib/payments/asaas'
import { PaymentProviderError } from '@/lib/payments/provider'
import { webhookUrl } from '@/lib/payments'
import carneCreate from './fixtures/installment-carne-create.json'
import carnePayments from './fixtures/installment-carne-payments.json'
import cardCreate from './fixtures/installment-card-create.json'
import cardPayments from './fixtures/installment-card-payments.json'
import singleUndefined from './fixtures/payment-single-undefined.json'
import getDeleted from './fixtures/payment-get-deleted.json'
import customerCreate from './fixtures/customer-create.json'
import webhookCreate from './fixtures/webhook-create.json'
import whReceived from './fixtures/webhook-payment-received.json'
import whInvoice from './fixtures/webhook-invoice-authorized.json'
import invoiceCreate from './fixtures/invoice-create.json'
import invoiceList from './fixtures/invoice-list.json'
import error400 from './fixtures/error-400.json'
import error401 from './fixtures/error-401.json'

const res = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

type Call = { url: string; init: RequestInit; body: Record<string, unknown> | undefined }

function make(handler: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = { url: String(url), init: init ?? {}, body: init?.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(call)
    return handler(call)
  })
  const provider = new AsaasProvider({
    apiKey: 'KEY123',
    environment: 'sandbox',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  })
  return { provider, calls }
}

const emptyList = { object: 'list', hasMore: false, totalCount: 0, limit: 10, offset: 0, data: [] }
const listOf = (...data: unknown[]) => ({ ...emptyList, totalCount: data.length, data })

const baseCharge = {
  customerId: 'cus_1',
  externalReference: 'pay-1',
  description: 'Tratamento',
  totalCents: 10000,
  installmentCount: 3,
  firstDueDate: '2026-11-20',
  finePercent: 2,
  interestPercentMonth: 1,
}

const carneHandler = (c: Call) =>
  c.url.endsWith('/payments') && c.init.method === 'POST' ? res(200, carneCreate) : res(200, carnePayments)

describe('AsaasProvider.createCharge', () => {
  it('createCharge carne returns 3 charges in installment order with invoiceUrl', async () => {
    const { provider, calls } = make(carneHandler)
    const out = await provider.createCharge({ ...baseCharge, kind: 'carne' })
    expect(out.map((c) => c.installmentNumber)).toEqual([1, 2, 3])
    expect(out.map((c) => c.valueCents)).toEqual([3333, 3333, 3334])
    expect(out.every((c) => c.invoiceUrl?.startsWith('https://'))).toBe(true)
    expect(out[0].installmentId).toBe('40a790e7-38b3-4861-8e0e-d0a2d60a6fd2')
    expect(calls[0].url).toBe('https://api-sandbox.asaas.com/v3/payments')
    expect(calls[1].url).toContain('/installments/40a790e7-38b3-4861-8e0e-d0a2d60a6fd2/payments')
    expect(calls[0].body).toMatchObject({ billingType: 'BOLETO', installmentCount: 3, totalValue: 100, dueDate: '2026-11-20' })
  })

  it('createCharge sends notificationDisabled customer and fine/interest', async () => {
    const { provider, calls } = make(carneHandler)
    await provider.createCharge({ ...baseCharge, kind: 'carne' })
    expect(calls[0].body).toMatchObject({
      customer: 'cus_1',
      externalReference: 'pay-1',
      fine: { value: 2 },
      interest: { value: 1 },
    })
    const { provider: p2, calls: c2 } = make((c) =>
      c.init.method === 'GET' ? res(200, emptyList) : res(200, customerCreate),
    )
    await p2.ensureCustomer({ externalId: 'pac-1', name: 'A', cpf: '52998224725' })
    expect(c2[1].body).toMatchObject({ notificationDisabled: true })
  })

  it('createCharge avulsa does not send installment fields', async () => {
    const { provider, calls } = make(() => res(200, singleUndefined))
    const out = await provider.createCharge({ ...baseCharge, kind: 'avulsa', installmentCount: 1 })
    expect(out).toHaveLength(1)
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toMatchObject({ billingType: 'UNDEFINED', value: 100 })
    expect(calls[0].body).not.toHaveProperty('installmentCount')
    expect(calls[0].body).not.toHaveProperty('totalValue')
  })

  it('card installment uses CREDIT_CARD', async () => {
    const { provider, calls } = make((c) =>
      c.init.method === 'POST' ? res(200, cardCreate) : res(200, cardPayments),
    )
    await provider.createCharge({ ...baseCharge, kind: 'cartao_parcelado', totalCents: 9000 })
    expect(calls[0].body).toMatchObject({ billingType: 'CREDIT_CARD', installmentCount: 3, totalValue: 90 })
  })
})

describe('AsaasProvider errors and headers', () => {
  it('maps 401 to invalid_key, 400 to validation with Asaas description, 404 to not_found, 500/429/network/timeout to unavailable', async () => {
    const run = async (r: () => Response | Promise<Response>) => {
      const { provider } = make(r)
      try {
        await provider.getCharge('pay_x')
      } catch (e) {
        expect(e).toBeInstanceOf(PaymentProviderError)
        return e as PaymentProviderError
      }
      throw new Error('should throw')
    }
    expect((await run(() => res(401, error401))).kind).toBe('invalid_key')
    const v = await run(() => res(400, error400))
    expect(v.kind).toBe('validation')
    expect(v.message).toBe(error400.errors[0].description)
    expect((await run(() => new Response('', { status: 404 }))).kind).toBe('not_found')
    expect((await run(() => res(422, error400))).kind).toBe('validation')
    expect((await run(() => res(408, {}))).kind).toBe('unavailable')
    expect((await run(() => res(500, {}))).kind).toBe('unavailable')
    expect((await run(() => res(429, {}))).kind).toBe('unavailable')
    expect(
      (await run(() => {
        throw new TypeError('fetch failed')
      })).kind,
    ).toBe('unavailable')
    expect(
      (await run(() => {
        throw new DOMException('timeout', 'TimeoutError')
      })).kind,
    ).toBe('unavailable')
  })

  it('sends access_token and User-Agent headers', async () => {
    const { provider, calls } = make(() => res(200, getDeleted))
    await provider.getCharge('pay_x')
    const h = calls[0].init.headers as Record<string, string>
    expect(h.access_token).toBe('KEY123')
    expect(h['User-Agent']).toBeTruthy()
  })

  it('scheduleInvoice invalid_fiscal_info is a validation error with the Asaas description', async () => {
    const { provider } = make(() => res(400, invoiceCreate))
    await expect(
      provider.scheduleInvoice({
        chargeId: 'pay_1',
        valueCents: 5000,
        description: 'x',
        serviceCode: '4.12',
        issRate: 2,
        externalReference: 'r',
      }),
    ).rejects.toMatchObject({
      kind: 'validation',
      code: 'invalid_fiscal_info',
      message: invoiceCreate.errors[0].description,
    })
  })
})

describe('AsaasProvider mapping', () => {
  it('getCharge maps deleted', async () => {
    const { provider } = make(() => res(200, getDeleted))
    const c = await provider.getCharge('pay_3wqpia3fylgtnw7h')
    expect(c.deleted).toBe(true)
    expect(c.status).toBe('PENDING')
  })

  it('valueCents from 33.33 is 3333', async () => {
    const { provider } = make(() => res(200, { ...getDeleted, value: 33.33, netValue: 32.18 }))
    const c = await provider.getCharge('x')
    expect(c.valueCents).toBe(3333)
    expect(c.netValueCents).toBe(3218)
  })

  it('getFiscalStatus: 404 means not configured, 200 configured', async () => {
    const a = make(() => new Response('', { status: 404 }))
    expect(await a.provider.getFiscalStatus()).toEqual({
      configured: false,
      missing: ['Dados fiscais não cadastrados no Asaas'],
    })
    const b = make(() => res(200, { municipalInscription: '1' }))
    expect(await b.provider.getFiscalStatus()).toEqual({ configured: true, missing: [] })
  })

  it('ensureCustomer reuses existing customer by externalReference', async () => {
    const { provider, calls } = make(() =>
      res(200, listOf({ ...customerCreate, id: 'cus_old', deleted: true }, customerCreate)),
    )
    expect(await provider.ensureCustomer({ externalId: 'pac 1', name: 'Ana', cpf: '52998224725' })).toBe('cus_000009834094')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/customers?externalReference=pac%201')
  })

  it('ensureCustomer creates when none exists', async () => {
    const { provider, calls } = make((c) =>
      c.init.method === 'GET' ? res(200, emptyList) : res(200, customerCreate),
    )
    expect(await provider.ensureCustomer({ externalId: 'pac-1', name: 'Ana', cpf: '52998224725' })).toBe('cus_000009834094')
    expect(calls.map((c) => c.init.method)).toEqual(['GET', 'POST'])
  })

  it('ensureCustomer sends externalReference = patient id', async () => {
    const { provider, calls } = make((c) =>
      c.init.method === 'GET' ? res(200, emptyList) : res(200, customerCreate),
    )
    const id = await provider.ensureCustomer({ externalId: 'pac-1', name: 'Ana', cpf: '52998224725', phone: '11999990000' })
    expect(id).toBe('cus_000009834094')
    expect(calls[1].body).toMatchObject({ externalReference: 'pac-1', cpfCnpj: '52998224725', mobilePhone: '11999990000' })
  })

  it('registerWebhook sends authToken, SEQUENTIALLY and the event list', async () => {
    const { provider, calls } = make(() => res(200, webhookCreate))
    const out = await provider.registerWebhook('https://app.test/api/webhooks/asaas', 'tok-xyz', 'clinica@x.com')
    expect(out.webhookId).toBe(webhookCreate.id)
    expect(calls[0].body).toMatchObject({
      url: 'https://app.test/api/webhooks/asaas',
      email: 'clinica@x.com',
      authToken: 'tok-xyz',
      sendType: 'SEQUENTIALLY',
      enabled: true,
      apiVersion: 3,
      events: [...ASAAS_WEBHOOK_EVENTS],
    })
  })
})

describe('AsaasProvider.parseWebhook', () => {
  const { provider } = make(() => res(200, {}))

  it('parseWebhook payment and invoice fixtures', () => {
    const p = provider.parseWebhook(whReceived)!
    expect(p.eventId).toBe(whReceived.id)
    expect(p.event).toBe('PAYMENT_RECEIVED')
    expect(p.charge).toMatchObject({
      id: 'pay_f7m5z8mnf6p4h3lz',
      status: 'RECEIVED',
      valueCents: 5000,
      netValueCents: 4852,
      paidAt: '2026-11-20',
      deleted: false,
    })
    const i = provider.parseWebhook(whInvoice)!
    expect(i.event).toBe('INVOICE_AUTHORIZED')
    expect(i.invoice).toMatchObject({
      id: 'inv_000000000001',
      status: 'AUTHORIZED',
      number: '1',
      pdfUrl: 'https://sandbox.asaas.com/exemplo.pdf',
      externalReference: 'teste-nfse-1',
    })
  })

  it('parseWebhook returns null for unknown shape', () => {
    expect(provider.parseWebhook(null)).toBeNull()
    expect(provider.parseWebhook('x')).toBeNull()
    expect(provider.parseWebhook({})).toBeNull()
    expect(provider.parseWebhook({ id: 'evt_1', event: 'PAYMENT_RECEIVED' })).toBeNull()
    expect(provider.parseWebhook({ id: 'evt_1', event: 'PAYMENT_RECEIVED', payment: { id: 5 } })).toBeNull()
  })
})

describe('webhookUrl', () => {
  const old = { ...process.env }
  afterEach(() => {
    process.env = { ...old }
  })
  it('webhookUrl prefers ASAAS_WEBHOOK_BASE_URL over APP_URL and trims slash', () => {
    process.env.APP_URL = 'https://app.test/'
    process.env.ASAAS_WEBHOOK_BASE_URL = 'https://tunnel.test//'
    expect(webhookUrl()).toBe('https://tunnel.test/api/webhooks/asaas')
    delete process.env.ASAAS_WEBHOOK_BASE_URL
    expect(webhookUrl()).toBe('https://app.test/api/webhooks/asaas')
  })
})

describe('findInvoiceByReference', () => {
  it('queries by encoded externalReference and returns the first active invoice', async () => {
    const { provider, calls } = make(() => res(200, invoiceList))
    const inv = await provider.findInvoiceByReference('p 1')
    expect(calls[0].url).toContain('/invoices?externalReference=p%201')
    expect(inv?.id).toBe('inv_live')
  })
  it('returns null when only cancelled/error invoices exist', async () => {
    const { provider } = make(() => res(200, { ...invoiceList, data: invoiceList.data.slice(0, 2) }))
    expect(await provider.findInvoiceByReference('p1')).toBeNull()
  })
})
