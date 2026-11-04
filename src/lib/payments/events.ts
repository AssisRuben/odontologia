import { parseAsaasWebhook } from './asaas'
import type { ParsedWebhook, ProviderCharge, ProviderInvoice } from './provider'
import { applyPaymentEvent, type LocalStatus, type PaymentPatch } from './status'

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
  findClinicByToken(token: string): Promise<{ clinicId: string; nfseAuto: boolean } | null>
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
  updatePayment(
    clinicId: string,
    paymentId: string,
    patch: Omit<PaymentPatch, 'becamePaid'>,
  ): Promise<void>
  listGroup(
    clinicId: string,
    groupId: string,
  ): Promise<{ id: string; installmentNumber: number | null; amountCents: number }[]>
  /** Existe nota (nos status dados, ou em qualquer status) para algum dos lançamentos. */
  hasInvoice(clinicId: string, paymentIds: string[], statuses: InvoiceStatus[] | 'any'): Promise<boolean>
  scheduleInvoice(clinicId: string, paymentId: string, opts: { valueCents?: number }): Promise<void>
  /** Atualiza a nota pelo id do Asaas; false se não existir. */
  updateInvoice(clinicId: string, providerInvoiceId: string, patch: InvoicePatch): Promise<boolean>
  today(clinicId: string, now: Date): Promise<string>
}

const PAID_EVENTS = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_RECEIVED_IN_CASH'])

function errMsg(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Erro desconhecido'
}

function invoicePatch(event: string, inv: ProviderInvoice): InvoicePatch | null {
  switch (event) {
    case 'INVOICE_AUTHORIZED':
      return { status: 'authorized', number: inv.number, pdf_url: inv.pdfUrl, xml_url: inv.xmlUrl, error: null }
    case 'INVOICE_ERROR':
      return { status: 'error', error: inv.error ?? 'Erro na emissão da nota' }
    case 'INVOICE_CANCELED':
      return { status: 'cancelled' }
    case 'INVOICE_CANCELLATION_DENIED':
      return { status: 'authorized', error: inv.error ?? 'Cancelamento negado pela prefeitura' }
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
  const statuses: InvoiceStatus[] | 'any' = reprocess ? 'any' : ['scheduled', 'authorized']
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
  const patch = applyPaymentEvent(
    {
      status: payment.status,
      due_date: payment.dueDate,
      hasAuthorizedInvoice: payment.hasAuthorizedInvoice,
      net_amount_cents: payment.netAmountCents,
      paid_at: payment.paidAt,
      amount_cents: payment.amountCents,
    },
    parsed.event,
    parsed.charge,
    today,
  )
  if (patch) {
    const { becamePaid, ...fields } = patch
    void becamePaid
    await deps.updatePayment(clinicId, payment.id, fields)
  }
  const paidNow = patch?.becamePaid === true
  const paidRetry = reprocess && PAID_EVENTS.has(parsed.event) && (paidNow || payment.status === 'paid')
  if (paidNow || paidRetry) {
    const nfseAuto = await deps.getNfseAuto(clinicId)
    if (nfseAuto) {
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
  const patch = invoicePatch(parsed.event, parsed.invoice)
  if (!patch) return { result: 'ignored' }
  const found = await deps.updateInvoice(clinicId, parsed.invoice.id, patch)
  return { result: found ? 'processed' : 'ignored' }
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
): Promise<{ status: 200 | 401; result: EventResult }> {
  if (!token) return { status: 401, result: 'ignored' }
  const clinic = await deps.findClinicByToken(token)
  if (!clinic) return { status: 401, result: 'ignored' }

  const parsed = parseAsaasWebhook(body)
  if (!parsed) return { status: 200, result: 'ignored' }

  try {
    // Persiste primeiro como 'failed': se o processo cair no meio, a conferência reprocessa.
    const inserted = await deps.insertEvent({
      clinicId: clinic.clinicId,
      providerEventId: parsed.eventId,
      event: parsed.event,
      payload: body,
      status: 'failed',
      error: 'Processamento interrompido',
      receivedAt: now,
    })
    if (!inserted) return { status: 200, result: 'duplicate' }

    const out = await process(clinic.clinicId, parsed, deps, now, false)
    await deps.finishEvent(clinic.clinicId, inserted.id, out.result, out.error ?? null)
    return { status: 200, result: out.result }
  } catch (e) {
    console.error('[webhooks/asaas] falha ao registrar o evento:', errMsg(e))
    return { status: 200, result: 'failed' }
  }
}

/** Reaplica o payload de um evento guardado como 'failed' (usado pela conferência). */
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
