export type ProviderCharge = {
  id: string
  installmentId: string | null
  installmentNumber: number | null
  status: string
  deleted: boolean
  valueCents: number
  netValueCents: number | null
  dueDate: string
  paidAt: string | null
  invoiceUrl: string | null
  externalReference: string | null
}

export type ProviderInvoice = {
  id: string
  status: string
  number: string | null
  pdfUrl: string | null
  xmlUrl: string | null
  error: string | null
  externalReference: string | null
}

export type ParsedWebhook = {
  eventId: string
  event: string
  charge?: ProviderCharge
  invoice?: ProviderInvoice
}

export type PaymentProviderErrorKind = 'invalid_key' | 'validation' | 'not_found' | 'unavailable'

export class PaymentProviderError extends Error {
  constructor(
    public kind: PaymentProviderErrorKind,
    message: string,
    /** Código de erro do provedor (ex.: invalid_fiscal_info), quando houver. */
    public code: string | null = null,
  ) {
    super(message)
    this.name = 'PaymentProviderError'
  }
}

export type ChargeKind = 'avulsa' | 'carne' | 'cartao_parcelado'

export interface PaymentProvider {
  verifyKey(): Promise<{ accountName: string }>
  registerWebhook(url: string, token: string): Promise<{ webhookId: string }>
  removeWebhook(webhookId: string): Promise<void>
  ensureCustomer(c: {
    externalId: string
    name: string
    cpf: string
    phone?: string
    email?: string
  }): Promise<string>
  createCharge(c: {
    customerId: string
    externalReference: string
    description: string
    kind: ChargeKind
    totalCents: number
    installmentCount: number
    firstDueDate: string
    finePercent: number
    interestPercentMonth: number
  }): Promise<ProviderCharge[]>
  getCharge(id: string): Promise<ProviderCharge>
  listChargesByReference(externalReference: string): Promise<ProviderCharge[]>
  receiveInCash(id: string, paidAt: string, valueCents: number): Promise<void>
  cancelCharge(id: string): Promise<void>
  cancelInstallment(installmentId: string): Promise<void>
  updateDueDate(id: string, dueDate: string): Promise<ProviderCharge>
  getFiscalStatus(): Promise<{ configured: boolean; missing: string[] }>
  scheduleInvoice(i: {
    chargeId?: string
    installmentId?: string
    customerId?: string
    valueCents: number
    description: string
    serviceCode: string
    issRate: number
    externalReference: string
  }): Promise<ProviderInvoice>
  cancelInvoice(id: string): Promise<void>
  getInvoice(id: string): Promise<ProviderInvoice>
  parseWebhook(body: unknown): ParsedWebhook | null
}
