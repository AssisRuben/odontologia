import { parseAsaasWebhook } from './asaas'
import type { ParsedWebhook, ProviderCharge, ProviderInvoice } from './provider'
import { applyPaymentEvent, applyProviderStatus, type LocalStatus, type PaymentPatch } from './status'

export type EventResult = 'processed' | 'ignored' | 'failed' | 'duplicate'
type FinalResult = Exclude<EventResult, 'duplicate'>
export type InvoiceStatus = 'scheduled' | 'authorized' | 'error' | 'cancelling' | 'cancelled'

/** Lançamento como o webhook o enxerga. */
export interface EventPayment {
  id: string
  providerChargeId: string | null
  status: LocalStatus
  dueDate: string | null
  amountCents: number
  /** 'YYYY-MM-DD' (já passou por fromDbPaidAt). */
  paidAt: string | null
  netAmountCents: number | null
  /** Há nota autorizada para o lançamento (ou para o grupo, no cartão parcelado). */
  hasAuthorizedInvoice: boolean
  chargeKind: 'manual' | 'avulsa' | 'carne' | 'cartao_parcelado'
  chargeGroupId: string | null
  installmentNumber: number | null
}

export interface InvoicePatch {
  status: InvoiceStatus
  number?: string | null
  pdf_url?: string | null
  xml_url?: string | null
  error?: string | null
}

export interface EventDeps {
  findClinicByToken(token: string): Promise<{ clinicId: string } | null>
  getNfseAuto(clinicId: string): Promise<boolean>
  /** Grava o evento; null se já existia (provider_event_id repetido). */
  insertEvent(e: {
    clinicId: string
    providerEventId: string
    event: string
    payload: unknown
    status: 'failed' | 'processed' | 'ignored'
    error: string | null
    receivedAt: Date
  }): Promise<{ id: string } | null>
  finishEvent(clinicId: string, id: string, status: FinalResult, error: string | null): Promise<void>
  findPayment(clinicId: string, providerChargeId: string): Promise<EventPayment | null>
  /** Estado atual da cobrança no provedor (usado só no reprocesso). */
  getCharge(clinicId: string, providerChargeId: string): Promise<ProviderCharge>
  /** Grava só se o status ainda for expectedStatus; false se nenhuma linha mudou. */
  updatePayment(
    clinicId: string,
    paymentId: string,
    patch: Omit<PaymentPatch, 'becamePaid'>,
    expectedStatus: LocalStatus,
  ): Promise<boolean>
  listGroup(
    clinicId: string,
    groupId: string,
  ): Promise<{ id: string; installmentNumber: number | null; amountCents: number }[]>
  /** Existe nota (nos status dados, ou em qualquer status) para algum dos lançamentos. */
  hasInvoice(clinicId: string, paymentIds: string[], statuses: InvoiceStatus[] | 'any'): Promise<boolean>
  scheduleInvoice(clinicId: string, paymentId: string, opts: { valueCents?: number }): Promise<void>
  /** Atualiza a nota pelo id do Asaas, só se o status atual estiver em allowedFrom; false se nada mudou. */
  updateInvoice(
    clinicId: string,
    providerInvoiceId: string,
    patch: InvoicePatch,
    allowedFrom: InvoiceStatus[],
  ): Promise<boolean>
  today(clinicId: string, now: Date): Promise<string>
}

const PAID_PROVIDER_STATUS = new Set(['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'])
const ACTIVE_INVOICE: InvoiceStatus[] = ['scheduled', 'authorized', 'cancelling']

function errMsg(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Erro desconhecido'
}

/** Remove dados de cartão do payload antes de guardar. */
export function sanitizePayload(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body
  const b = body as Record<string, unknown>
  const strip = (o: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(o).filter(([k]) => !k.toLowerCase().startsWith('creditcard')))
  const out = strip(b)
  const p = b.payment
  if (p && typeof p === 'object' && !Array.isArray(p)) out.payment = strip(p as Record<string, unknown>)
  return out
}

function invoiceTransition(event: string, inv: ProviderInvoice): { patch: InvoicePatch; from: InvoiceStatus[] } | null {
  switch (event) {
    case 'INVOICE_AUTHORIZED':
      return {
        patch: { status: 'authorized', number: inv.number, pdf_url: inv.pdfUrl, xml_url: inv.xmlUrl, error: null },
        from: ['scheduled', 'error'],
      }
    case 'INVOICE_ERROR':
      return { patch: { status: 'error', error: inv.error ?? 'Erro na emissão da nota' }, from: ['scheduled'] }
    case 'INVOICE_CANCELED':
      return { patch: { status: 'cancelled' }, from: ['cancelling', 'authorized'] }
    case 'INVOICE_CANCELLATION_DENIED':
      return {
        patch: { status: 'authorized', error: inv.error ?? 'Cancelamento negado pela prefeitura' },
        from: ['cancelling'],
      }
    default:
      return null
  }
}

async function maybeScheduleInvoice(
  clinicId: string,
  payment: EventPayment,
  deps: EventDeps,
  reprocess: boolean,
): Promise<void> {
  // Reprocesso: a baixa já foi gravada, então confere se falta a nota (em qualquer status, para não reemitir a cancelada).
  const statuses: InvoiceStatus[] | 'any' = reprocess ? 'any' : ACTIVE_INVOICE
  if (payment.chargeKind === 'cartao_parcelado' && payment.chargeGroupId) {
    const group = await deps.listGroup(clinicId, payment.chargeGroupId)
    const first = group.find((r) => r.installmentNumber === 1)
    if (!first) return
    if (await deps.hasInvoice(clinicId, group.map((r) => r.id), statuses)) return
    await deps.scheduleInvoice(clinicId, first.id, { valueCents: group.reduce((s, r) => s + r.amountCents, 0) })
    return
  }
  if (await deps.hasInvoice(clinicId, [payment.id], statuses)) return
  await deps.scheduleInvoice(clinicId, payment.id, {})
}

async function processCharge(
  clinicId: string,
  parsed: ParsedWebhook & { charge: ProviderCharge },
  deps: EventDeps,
  now: Date,
  reprocess: boolean,
): Promise<{ result: FinalResult; error?: string }> {
  const payment = await deps.findPayment(clinicId, parsed.charge.id)
  if (!payment) return { result: 'ignored' }
  const today = await deps.today(clinicId, now)
  // No reprocesso o payload guardado pode estar velho: vale o estado atual do provedor.
  const charge = reprocess ? await deps.getCharge(clinicId, parsed.charge.id) : parsed.charge
  const state = {
    status: payment.status,
    due_date: payment.dueDate,
    hasAuthorizedInvoice: payment.hasAuthorizedInvoice,
    net_amount_cents: payment.netAmountCents,
    paid_at: payment.paidAt,
    amount_cents: payment.amountCents,
  }
  const patch = reprocess
    ? applyProviderStatus(state, charge, today)
    : applyPaymentEvent(state, parsed.event, charge, today)

  let becamePaid = false
  if (patch) {
    const { becamePaid: bp, ...fields } = patch
    const landed = await deps.updatePayment(clinicId, payment.id, fields, payment.status)
    if (!landed) return { result: 'failed', error: 'Lançamento alterado durante o processamento' }
    becamePaid = bp === true
  }
  const paidRetry = reprocess && PAID_PROVIDER_STATUS.has(charge.status) && !charge.deleted && payment.status === 'paid'
  if (becamePaid || paidRetry) {
    if (await deps.getNfseAuto(clinicId)) {
      try {
        await maybeScheduleInvoice(clinicId, payment, deps, reprocess)
      } catch (e) {
        // A baixa já foi gravada; só o evento fica como falho para nova tentativa.
        return { result: 'failed', error: errMsg(e) }
      }
    }
  }
  return { result: 'processed' }
}

async function processInvoice(
  clinicId: string,
  parsed: ParsedWebhook & { invoice: ProviderInvoice },
  deps: EventDeps,
): Promise<{ result: FinalResult }> {
  const t = invoiceTransition(parsed.event, parsed.invoice)
  if (!t) return { result: 'ignored' }
  const changed = await deps.updateInvoice(clinicId, parsed.invoice.id, t.patch, t.from)
  return { result: changed ? 'processed' : 'ignored' }
}

async function process(
  clinicId: string,
  parsed: ParsedWebhook,
  deps: EventDeps,
  now: Date,
  reprocess: boolean,
): Promise<{ result: FinalResult; error?: string }> {
  try {
    if (parsed.charge) return await processCharge(clinicId, { ...parsed, charge: parsed.charge }, deps, now, reprocess)
    if (parsed.invoice) return await processInvoice(clinicId, { ...parsed, invoice: parsed.invoice }, deps)
    return { result: 'ignored' }
  } catch (e) {
    return { result: 'failed', error: errMsg(e) }
  }
}

export async function handleWebhook(
  token: string | null,
  body: unknown,
  deps: EventDeps,
  now: Date,
): Promise<{ status: 200 | 401 | 500; result: EventResult }> {
  if (!token) return { status: 401, result: 'ignored' }
  let clinicId: string
  try {
    const clinic = await deps.findClinicByToken(token)
    if (!clinic) return { status: 401, result: 'ignored' }
    clinicId = clinic.clinicId
  } catch (e) {
    console.error('[webhooks/asaas] falha ao identificar a clínica:', errMsg(e))
    return { status: 500, result: 'failed' }
  }

  const parsed = parseAsaasWebhook(body)
  if (!parsed) return { status: 200, result: 'ignored' }

  let inserted: { id: string } | null
  try {
    // Persiste primeiro como 'failed': se o processo cair no meio, a conferência reprocessa.
    inserted = await deps.insertEvent({
      clinicId,
      providerEventId: parsed.eventId,
      event: parsed.event,
      payload: sanitizePayload(body),
      status: 'failed',
      error: 'Processamento interrompido',
      receivedAt: now,
    })
  } catch (e) {
    // Sem o evento gravado, devolve 500 para o Asaas tentar de novo.
    console.error('[webhooks/asaas] falha ao registrar o evento:', errMsg(e))
    return { status: 500, result: 'failed' }
  }
  if (!inserted) return { status: 200, result: 'duplicate' }

  const out = await process(clinicId, parsed, deps, now, false)
  try {
    await deps.finishEvent(clinicId, inserted.id, out.result, out.error ?? null)
  } catch (e) {
    console.error('[webhooks/asaas] falha ao finalizar o evento:', errMsg(e))
    return { status: 200, result: 'failed' }
  }
  return { status: 200, result: out.result }
}

/** Reaplica um evento guardado como 'failed' (usado pela conferência), com o estado atual do provedor. */
export async function reprocessEvent(
  eventRow: { id: string; clinic_id: string; payload: unknown },
  deps: EventDeps,
  now: Date,
): Promise<FinalResult> {
  const parsed = parseAsaasWebhook(eventRow.payload)
  const out = parsed
    ? await process(eventRow.clinic_id, parsed, deps, now, true)
    : ({ result: 'ignored' } as { result: FinalResult; error?: string })
  await deps.finishEvent(eventRow.clinic_id, eventRow.id, out.result, out.error ?? null)
  return out.result
}
