import { todayYmd } from '@/lib/messaging/time'
import { fromCents, toCents } from './money'
import {
  PaymentProviderError,
  type ParsedWebhook,
  type PaymentProvider,
  type ProviderCharge,
  type ProviderInvoice,
} from './provider'

const TIMEOUT_MS = 15_000
const USER_AGENT = 'odontologia-app'

const BASE_URLS = {
  sandbox: 'https://api-sandbox.asaas.com/v3',
  production: 'https://api.asaas.com/v3',
} as const

/** Eventos que o app assina no webhook (spec §6.3). */
export const ASAAS_WEBHOOK_EVENTS = [
  'PAYMENT_CREATED',
  'PAYMENT_UPDATED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
  'PAYMENT_OVERDUE',
  'PAYMENT_DELETED',
  'PAYMENT_RESTORED',
  'PAYMENT_REFUNDED',
  'PAYMENT_RECEIVED_IN_CASH_UNDONE',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
  'INVOICE_CREATED',
  'INVOICE_UPDATED',
  'INVOICE_SYNCHRONIZED',
  'INVOICE_AUTHORIZED',
  'INVOICE_PROCESSING_CANCELLATION',
  'INVOICE_CANCELED',
  'INVOICE_CANCELLATION_DENIED',
  'INVOICE_ERROR',
] as const

export interface AsaasOptions {
  apiKey: string
  environment: 'sandbox' | 'production'
  fetchImpl?: typeof fetch
}

type Json = Record<string, unknown>

function asObject(v: unknown): Json | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Converte um objeto `payment` do Asaas; null se faltar o essencial. */
function mapCharge(raw: unknown): ProviderCharge | null {
  const p = asObject(raw)
  if (!p) return null
  const id = str(p.id)
  const value = num(p.value)
  const dueDate = str(p.dueDate)
  const status = str(p.status)
  if (!id || value === null || !dueDate || !status) return null
  const net = num(p.netValue)
  return {
    id,
    installmentId: str(p.installment),
    installmentNumber: num(p.installmentNumber),
    status,
    deleted: p.deleted === true,
    valueCents: toCents(value),
    netValueCents: net === null ? null : toCents(net),
    dueDate,
    paidAt: str(p.paymentDate) ?? str(p.clientPaymentDate),
    invoiceUrl: str(p.invoiceUrl),
    externalReference: str(p.externalReference),
  }
}

function mapInvoice(raw: unknown): ProviderInvoice | null {
  const i = asObject(raw)
  if (!i) return null
  const id = str(i.id)
  const status = str(i.status)
  if (!id || !status) return null
  return {
    id,
    status,
    number: i.number == null || i.number === '' ? null : String(i.number),
    pdfUrl: str(i.pdfUrl),
    xmlUrl: str(i.xmlUrl),
    error: status === 'ERROR' || status === 'CANCELLATION_DENIED' ? str(i.statusDescription) : null,
    externalReference: str(i.externalReference),
  }
}

/** Interpreta o corpo de um webhook do Asaas; não precisa de chave de API. */
export function parseAsaasWebhook(body: unknown): ParsedWebhook | null {
  const b = asObject(body)
  if (!b) return null
  const eventId = str(b.id)
  const event = str(b.event)
  if (!eventId || !event) return null
  if (event.startsWith('PAYMENT_')) {
    const charge = mapCharge(b.payment)
    return charge ? { eventId, event, charge } : null
  }
  if (event.startsWith('INVOICE_')) {
    const invoice = mapInvoice(b.invoice)
    return invoice ? { eventId, event, invoice } : null
  }
  return null
}

function bad(what: string): PaymentProviderError {
  return new PaymentProviderError('unavailable', `Resposta inesperada do Asaas (${what})`)
}

const byInstallment = (a: ProviderCharge, b: ProviderCharge) =>
  (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0)

export class AsaasProvider implements PaymentProvider {
  private baseUrl: string
  private apiKey: string
  private fetchImpl: typeof fetch

  constructor(opts: AsaasOptions) {
    this.baseUrl = BASE_URLS[opts.environment]
    this.apiKey = opts.apiKey
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init))
  }

  /** Chamada HTTP com timeout; devolve o JSON (ou null se vazio). Erros viram PaymentProviderError. */
  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    let res: Response
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          access_token: this.apiKey,
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (e) {
      throw new PaymentProviderError('unavailable', `Falha de rede ao chamar o Asaas: ${(e as Error).message}`)
    }
    const text = await res.text().catch(() => '')
    let json: unknown = null
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
    if (res.ok) return json

    const first = asObject(Array.isArray(asObject(json)?.errors) ? (asObject(json)!.errors as unknown[])[0] : null)
    const description = str(first?.description)
    const code = str(first?.code)
    if (res.status === 401 || res.status === 403) {
      throw new PaymentProviderError('invalid_key', description ?? 'Chave de API inválida', code)
    }
    if (res.status === 400) {
      throw new PaymentProviderError('validation', description ?? 'Requisição recusada pelo Asaas', code)
    }
    if (res.status === 404) {
      throw new PaymentProviderError('not_found', description ?? 'Não encontrado no Asaas', code)
    }
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
      throw new PaymentProviderError('validation', description ?? `Requisição recusada pelo Asaas (HTTP ${res.status})`, code)
    }
    throw new PaymentProviderError('unavailable', `Asaas indisponível (HTTP ${res.status})`, code)
  }

  async verifyKey() {
    const json = await this.request('GET', '/myAccount/commercialInfo')
    const o = asObject(json)
    return { accountName: str(o?.companyName) ?? str(o?.name) ?? 'Conta Asaas' }
  }

  async registerWebhook(url: string, token: string) {
    const json = await this.request('POST', '/webhooks', {
      name: 'Odontologia',
      url,
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      authToken: token,
      sendType: 'SEQUENTIALLY',
      events: [...ASAAS_WEBHOOK_EVENTS],
    })
    const id = str(asObject(json)?.id)
    if (!id) throw bad('webhook sem id')
    return { webhookId: id }
  }

  async removeWebhook(webhookId: string) {
    await this.request('DELETE', `/webhooks/${encodeURIComponent(webhookId)}`)
  }

  async ensureCustomer(c: { externalId: string; name: string; cpf: string; phone?: string; email?: string }) {
    const existing = await this.request('GET', `/customers?externalReference=${encodeURIComponent(c.externalId)}&limit=10`)
    const list = asObject(existing)?.data
    if (Array.isArray(list)) {
      for (const raw of list) {
        const o = asObject(raw)
        const eid = str(o?.id)
        if (o && eid && o.deleted !== true) return eid
      }
    }
    const json = await this.request('POST', '/customers', {
      name: c.name,
      cpfCnpj: c.cpf,
      mobilePhone: c.phone,
      email: c.email,
      externalReference: c.externalId,
      notificationDisabled: true,
    })
    const id = str(asObject(json)?.id)
    if (!id) throw bad('cliente sem id')
    return id
  }

  async createCharge(c: Parameters<PaymentProvider['createCharge']>[0]) {
    const body: Json = {
      customer: c.customerId,
      externalReference: c.externalReference,
      description: c.description,
      dueDate: c.firstDueDate,
      fine: { value: c.finePercent },
      interest: { value: c.interestPercentMonth },
    }
    if (c.kind === 'avulsa') {
      body.billingType = 'UNDEFINED'
      body.value = fromCents(c.totalCents)
    } else {
      // Carnê usa BOLETO (UNDEFINED não permite alterar o vencimento de uma parcela).
      body.billingType = c.kind === 'carne' ? 'BOLETO' : 'CREDIT_CARD'
      body.installmentCount = c.installmentCount
      body.totalValue = fromCents(c.totalCents)
    }
    const json = await this.request('POST', '/payments', body)
    const first = mapCharge(json)
    if (!first) throw bad('cobrança criada inválida')
    if (c.kind === 'avulsa' || !first.installmentId) return [first]

    const list = await this.request('GET', `/installments/${encodeURIComponent(first.installmentId)}/payments?limit=100`)
    return this.mapList(list).sort(byInstallment)
  }

  private mapList(json: unknown): ProviderCharge[] {
    const data = asObject(json)?.data
    if (!Array.isArray(data)) throw bad('lista sem data')
    const out: ProviderCharge[] = []
    for (const raw of data) {
      const ch = mapCharge(raw)
      if (!ch) throw bad('cobrança inválida na lista')
      out.push(ch)
    }
    return out
  }

  async getCharge(id: string) {
    const ch = mapCharge(await this.request('GET', `/payments/${encodeURIComponent(id)}`))
    if (!ch) throw bad('cobrança inválida')
    return ch
  }

  async listChargesByReference(externalReference: string) {
    const json = await this.request('GET', `/payments?externalReference=${encodeURIComponent(externalReference)}&limit=100`)
    return this.mapList(json).sort(byInstallment)
  }

  async receiveInCash(id: string, paidAt: string, valueCents: number) {
    await this.request('POST', `/payments/${encodeURIComponent(id)}/receiveInCash`, {
      paymentDate: paidAt,
      value: fromCents(valueCents),
      notifyCustomer: false,
    })
  }

  async cancelCharge(id: string) {
    await this.request('DELETE', `/payments/${encodeURIComponent(id)}`)
  }

  async cancelInstallment(installmentId: string) {
    await this.request('DELETE', `/installments/${encodeURIComponent(installmentId)}`)
  }

  async updateDueDate(id: string, dueDate: string) {
    const ch = mapCharge(await this.request('PUT', `/payments/${encodeURIComponent(id)}`, { dueDate }))
    if (!ch) throw bad('cobrança inválida')
    return ch
  }

  async getFiscalStatus() {
    try {
      await this.request('GET', '/fiscalInfo')
      return { configured: true, missing: [] as string[] }
    } catch (e) {
      if (e instanceof PaymentProviderError && e.kind === 'not_found') {
        return { configured: false, missing: ['Dados fiscais não cadastrados no Asaas'] }
      }
      throw e
    }
  }

  async scheduleInvoice(i: Parameters<PaymentProvider['scheduleInvoice']>[0]) {
    const body: Json = {
      serviceDescription: i.description,
      observations: i.description,
      value: fromCents(i.valueCents),
      effectiveDate: todayYmd(new Date(), 'America/Sao_Paulo'),
      externalReference: i.externalReference,
      municipalServiceCode: i.serviceCode,
      municipalServiceName: i.description,
      taxes: { retainIss: false, iss: i.issRate },
    }
    if (i.chargeId) body.payment = i.chargeId
    else if (i.installmentId) body.installment = i.installmentId
    else if (i.customerId) body.customer = i.customerId
    const inv = mapInvoice(await this.request('POST', '/invoices', body))
    if (!inv) throw bad('nota inválida')
    return inv
  }

  async cancelInvoice(id: string) {
    await this.request('POST', `/invoices/${encodeURIComponent(id)}/cancel`)
  }

  async getInvoice(id: string) {
    const inv = mapInvoice(await this.request('GET', `/invoices/${encodeURIComponent(id)}`))
    if (!inv) throw bad('nota inválida')
    return inv
  }

  async findInvoiceByReference(externalReference: string) {
    const json = await this.request('GET', `/invoices?externalReference=${encodeURIComponent(externalReference)}&limit=100`)
    const data = asObject(json)?.data
    if (!Array.isArray(data)) throw bad('lista sem data')
    for (const raw of data) {
      const inv = mapInvoice(raw)
      if (inv && inv.status !== 'CANCELED' && inv.status !== 'ERROR') return inv
    }
    return null
  }

  parseWebhook(body: unknown): ParsedWebhook | null {
    return parseAsaasWebhook(body)
  }
}
