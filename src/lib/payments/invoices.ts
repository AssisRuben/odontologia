import { toApiError } from './connection'
import { normalizeCpf } from './cpf'
import { PaymentProviderError, type PaymentProvider } from './provider'
import type { PaymentConnection } from './index'
import type { InvoiceStatus } from './events'
import type { LocalStatus } from './status'

export interface InvoicePayment {
  id: string
  patientId: string | null
  status: LocalStatus
  description: string | null
  amountCents: number
  chargeKind: 'manual' | 'avulsa' | 'carne' | 'cartao_parcelado'
  chargeGroupId: string | null
  installmentNumber: number | null
  providerChargeId: string | null
  providerInstallmentId: string | null
  providerState: 'creating' | 'active' | null
}

export interface InvoicePatient {
  id: string
  name: string
  cpf: string | null
  phone: string | null
  whatsapp: string | null
  email: string | null
}

export interface InvoiceDeps {
  getPayment(clinicId: string, paymentId: string): Promise<InvoicePayment | null>
  /** Todas as linhas do grupo de cobrança. */
  listGroup(clinicId: string, groupId: string): Promise<InvoicePayment[]>
  /** Existe nota scheduled/authorized/cancelling para algum dos lançamentos. */
  hasActiveInvoice(clinicId: string, paymentIds: string[]): Promise<boolean>
  getConnection(clinicId: string): Promise<{ provider: PaymentProvider; connection: PaymentConnection } | null>
  getPatient(clinicId: string, patientId: string): Promise<InvoicePatient | null>
  getCustomerId(clinicId: string, patientId: string): Promise<string | null>
  saveCustomerId(clinicId: string, patientId: string, customerId: string): Promise<void>
  /** null se a nota ativa única (23505) já existe. */
  insertInvoice(row: {
    clinicId: string
    paymentId: string
    providerInvoiceId: string
    status: 'scheduled'
    valueCents: number
    description: string
  }): Promise<{ id: string } | null>
  getInvoice(clinicId: string, invoiceId: string): Promise<{ id: string; providerInvoiceId: string; status: InvoiceStatus } | null>
  /** authorized → cancelling; false se o status mudou. */
  markCancelling(clinicId: string, invoiceId: string): Promise<boolean>
  markInvalidKey(clinicId: string): Promise<void>
}

export type InvoiceResult =
  | { status: 200; body: { ok: true; invoiceId: string } }
  | { status: number; body: { error: string } }

const fail = (status: number, error: string) => ({ status, body: { error } })

async function providerFailure(clinicId: string, e: unknown, deps: InvoiceDeps, tag: string) {
  if (e instanceof PaymentProviderError && e.code === 'invalid_fiscal_info') {
    return fail(409, 'Configure a nota fiscal no painel do Asaas')
  }
  const err = toApiError(e)
  if (err.status === 409) await deps.markInvalidKey(clinicId).catch(() => {})
  else if (err.status === 500) console.error(`[payments/${tag}] falha no Asaas:`, (e as Error).message)
  return fail(err.status, err.error)
}

export async function scheduleInvoiceForPayment(
  clinicId: string,
  paymentId: string,
  opts: { description?: string; valueCents?: number },
  deps: InvoiceDeps,
): Promise<InvoiceResult> {
  if (opts.valueCents !== undefined && (!Number.isInteger(opts.valueCents) || opts.valueCents <= 0)) {
    return fail(422, 'Valor inválido')
  }
  const requested = await deps.getPayment(clinicId, paymentId)
  if (!requested) return fail(404, 'Pagamento não encontrado')

  // Cartão parcelado: a nota fica na parcela 1 e cobre o total do parcelamento.
  let target = requested
  let group: InvoicePayment[] = [requested]
  const isCardGroup = requested.chargeKind === 'cartao_parcelado' && !!requested.chargeGroupId
  if (isCardGroup) {
    group = await deps.listGroup(clinicId, requested.chargeGroupId as string)
    if (!group.some((r) => r.id === requested.id)) group = [requested, ...group]
    target = group.find((r) => r.installmentNumber === 1) ?? requested
  }

  const paid = isCardGroup ? group.some((r) => r.status === 'paid') : requested.status === 'paid'
  if (!paid) return fail(409, 'A nota só pode ser emitida para pagamentos recebidos')
  if (target.providerState === 'creating') return fail(409, 'Cobrança ainda sendo criada. Aguarde alguns minutos.')

  if (await deps.hasActiveInvoice(clinicId, group.map((r) => r.id))) {
    return fail(409, 'Já existe uma nota ativa para este pagamento')
  }

  const conn = await deps.getConnection(clinicId)
  if (!conn) return fail(409, 'Conecte o Asaas em Configurações → Pagamentos')
  if (conn.connection.status !== 'connected') return fail(409, 'asaas_invalid_key')
  const { provider, connection } = conn
  if (connection.nfse_iss_rate === null || connection.nfse_iss_rate === undefined) {
    return fail(409, 'Configure a alíquota do ISS em Configurações → Pagamentos')
  }

  const valueCents = opts.valueCents ?? (isCardGroup ? group.reduce((s, r) => s + r.amountCents, 0) : target.amountCents)
  const given = opts.description?.trim()
  const description =
    given || connection.nfse_description.replace(/\{descricao\}/g, () => (requested.description ?? ''))

  let chargeId: string | undefined
  let installmentId: string | undefined
  let customerId: string | undefined
  if (target.chargeKind === 'manual' || !target.providerChargeId) {
    if (target.chargeKind !== 'manual') return fail(409, 'Cobrança ainda sendo criada. Aguarde alguns minutos.')
    if (!target.patientId) return fail(422, 'Informe o CPF do paciente')
    const patient = await deps.getPatient(clinicId, target.patientId)
    if (!patient) return fail(404, 'Paciente não encontrado')
    if (!patient.cpf?.trim()) return fail(422, 'Informe o CPF do paciente')
    const cpf = normalizeCpf(patient.cpf)
    if (!cpf) return fail(422, 'CPF inválido')
    try {
      let cached = await deps.getCustomerId(clinicId, patient.id)
      if (!cached) {
        cached = await provider.ensureCustomer({
          externalId: patient.id,
          name: patient.name,
          cpf,
          phone: patient.whatsapp ?? patient.phone ?? undefined,
          email: patient.email ?? undefined,
        })
        await deps.saveCustomerId(clinicId, patient.id, cached).catch((e) =>
          console.error('[payments/invoice] falha ao guardar o cliente:', (e as Error).message),
        )
      }
      customerId = cached
    } catch (e) {
      return providerFailure(clinicId, e, deps, 'invoice')
    }
  } else if (isCardGroup) {
    installmentId = target.providerInstallmentId ?? undefined
    if (!installmentId) chargeId = target.providerChargeId
  } else {
    chargeId = target.providerChargeId
  }

  let providerInvoiceId: string
  try {
    const inv = await provider.scheduleInvoice({
      chargeId,
      installmentId,
      customerId,
      valueCents,
      description,
      serviceCode: connection.nfse_service_code,
      issRate: connection.nfse_iss_rate,
      externalReference: target.id,
    })
    providerInvoiceId = inv.id
  } catch (e) {
    return providerFailure(clinicId, e, deps, 'invoice')
  }

  const cancelProvider = () =>
    provider.cancelInvoice(providerInvoiceId).catch((e) =>
      console.error('[payments/invoice] falha ao cancelar a nota órfã:', (e as Error).message),
    )
  let inserted: { id: string } | null
  try {
    inserted = await deps.insertInvoice({
      clinicId, paymentId: target.id, providerInvoiceId, status: 'scheduled', valueCents, description,
    })
  } catch (e) {
    await cancelProvider()
    throw e
  }
  if (!inserted) {
    await cancelProvider()
    return fail(409, 'Já existe uma nota ativa para este pagamento')
  }
  return { status: 200, body: { ok: true, invoiceId: inserted.id } }
}

export async function cancelInvoice(clinicId: string, invoiceId: string, deps: InvoiceDeps): Promise<InvoiceResult> {
  const inv = await deps.getInvoice(clinicId, invoiceId)
  if (!inv) return fail(404, 'Nota não encontrada')
  if (inv.status !== 'authorized') return fail(409, 'Só é possível cancelar notas autorizadas')
  const conn = await deps.getConnection(clinicId)
  if (!conn) return fail(409, 'Conecte o Asaas em Configurações → Pagamentos')
  try {
    await conn.provider.cancelInvoice(inv.providerInvoiceId)
  } catch (e) {
    return providerFailure(clinicId, e, deps, 'invoice-cancel')
  }
  if (!(await deps.markCancelling(clinicId, invoiceId))) {
    return fail(409, 'A nota mudou de situação. Atualize a tela.')
  }
  return { status: 200, body: { ok: true, invoiceId } }
}
