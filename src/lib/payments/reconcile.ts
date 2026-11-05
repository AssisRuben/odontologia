import { maybeScheduleInvoice, reprocessEvent, type EventDeps, type InvoicePatch, type InvoiceStatus } from './events'
import { PaymentProviderError, type PaymentProvider, type ProviderCharge, type ProviderInvoice } from './provider'
import { applyProviderStatus } from './status'

export interface ReconcileGroup {
  groupId: string
  /** Criação mais antiga entre as linhas 'creating' do grupo. */
  createdAt: Date
  /** Todas as linhas do grupo (inclusive as já ativas). */
  rows: { id: string; installmentNumber: number | null; providerChargeId: string | null; providerState: 'creating' | 'active' | null }[]
}

export interface ReconcileDeps {
  listConnectedClinics(): Promise<string[]>
  getConnection(clinicId: string): Promise<{ provider: PaymentProvider } | null>
  /** Grupos com ao menos uma linha 'creating'. */
  listCreatingGroups(clinicId: string): Promise<ReconcileGroup[]>
  /** Completa só as linhas 'creating' do grupo, casando pelo número da parcela; devolve quantas. */
  completeRows(clinicId: string, groupId: string, charges: ProviderCharge[]): Promise<number>
  /** Apaga só as linhas 'creating' do grupo. */
  deleteRows(clinicId: string, groupId: string): Promise<void>
  /** provider_charge_id dos lançamentos pending/overdue. */
  listOpenChargeIds(clinicId: string): Promise<string[]>
  /** Notas scheduled/cancelling atualizadas antes de `before`. */
  listStaleInvoices(clinicId: string, before: Date): Promise<{ providerInvoiceId: string; status: InvoiceStatus }[]>
  listFailedEvents(
    clinicId: string,
    olderThan: Date,
    newerThan: Date,
  ): Promise<{ id: string; clinic_id: string; payload: unknown }[]>
  purgeEvents(clinicId: string, before: Date): Promise<number>
  markInvalidKey(clinicId: string): Promise<void>
  events: EventDeps
  /** Relógio em ms (testes). */
  clock?: () => number
}

export interface ClinicReconcileResult {
  completed: number
  deleted: number
  updated: number
  invoices: number
  reprocessed: number
  error?: string
}

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const CREATING_MIN_AGE = 10 * MIN
const CREATING_DELETE_AGE = HOUR
const INVOICE_MIN_AGE = HOUR
const EVENT_MIN_AGE = 5 * MIN
const EVENT_MAX_AGE = 7 * DAY
const EVENT_RETENTION = 90 * DAY

const errMsg = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Erro desconhecido')
const isInvalidKey = (e: unknown) => e instanceof PaymentProviderError && e.kind === 'invalid_key'

async function reconcileGroups(
  clinicId: string,
  provider: PaymentProvider,
  deps: ReconcileDeps,
  now: Date,
  res: ClinicReconcileResult,
  alive: () => boolean,
): Promise<void> {
  for (const g of await deps.listCreatingGroups(clinicId)) {
    if (!alive()) return
    const age = now.getTime() - g.createdAt.getTime()
    if (age <= CREATING_MIN_AGE) continue
    const hasProviderCharge = g.rows.some((r) => !!r.providerChargeId)
    try {
      const charges = await provider.listChargesByReference(g.groupId)
      if (charges.length === 0) {
        if (age > CREATING_DELETE_AGE && !hasProviderCharge) {
          await deps.deleteRows(clinicId, g.groupId)
          res.deleted++
        } else if (age > CREATING_DELETE_AGE) {
          console.warn(`[cron/payments] grupo ${g.groupId}: Asaas não devolveu cobranças, mas há linhas já vinculadas; mantido`)
        }
        continue
      }
      if (charges.length === g.rows.length) {
        if ((await deps.completeRows(clinicId, g.groupId, charges)) > 0) res.completed++
      } else if (age > CREATING_DELETE_AGE) {
        console.warn(
          `[cron/payments] grupo ${g.groupId}: Asaas devolveu ${charges.length} cobranças para ${g.rows.length} linhas; mantido`,
        )
      }
    } catch (e) {
      if (isInvalidKey(e)) throw e
      console.error(`[cron/payments] grupo ${g.groupId}:`, errMsg(e))
      res.error ??= errMsg(e)
    }
  }
}

async function reconcileOpenPayments(
  clinicId: string,
  provider: PaymentProvider,
  deps: ReconcileDeps,
  now: Date,
  res: ClinicReconcileResult,
  alive: () => boolean,
): Promise<void> {
  const ev = deps.events
  const today = await ev.today(clinicId, now)
  for (const chargeId of await deps.listOpenChargeIds(clinicId)) {
    if (!alive()) return
    try {
      const payment = await ev.findPayment(clinicId, chargeId)
      if (!payment) continue
      const charge = await provider.getCharge(chargeId)
      const patch = applyProviderStatus(
        {
          status: payment.status,
          due_date: payment.dueDate,
          hasAuthorizedInvoice: payment.hasAuthorizedInvoice,
          net_amount_cents: payment.netAmountCents,
          paid_at: payment.paidAt,
          amount_cents: payment.amountCents,
        },
        charge,
        today,
      )
      if (!patch) continue
      const { becamePaid, ...fields } = patch
      if (!(await ev.updatePayment(clinicId, payment.id, fields, payment.status))) continue
      res.updated++
      if (becamePaid && (await ev.getNfseAuto(clinicId))) {
        try {
          await maybeScheduleInvoice(clinicId, payment, ev, false)
        } catch (e) {
          // A baixa foi gravada; a nota pode ser emitida manualmente.
          console.error(`[cron/payments] nota automática do lançamento ${payment.id}:`, errMsg(e))
        }
      }
    } catch (e) {
      if (isInvalidKey(e)) throw e
      console.error(`[cron/payments] cobrança ${chargeId}:`, errMsg(e))
      res.error ??= errMsg(e)
    }
  }
}

/** Traduz o estado da nota no provedor numa transição local; null se não há o que mudar. */
function invoiceTransition(
  local: InvoiceStatus,
  inv: ProviderInvoice,
): { patch: InvoicePatch; from: InvoiceStatus[] } | null {
  switch (inv.status) {
    case 'AUTHORIZED':
      return local === 'scheduled'
        ? {
            patch: { status: 'authorized', number: inv.number, pdf_url: inv.pdfUrl, xml_url: inv.xmlUrl, error: null },
            from: ['scheduled', 'error'],
          }
        : null
    case 'ERROR':
      return local === 'scheduled'
        ? { patch: { status: 'error', error: inv.error ?? 'Erro na emissão da nota' }, from: ['scheduled'] }
        : null
    case 'CANCELED':
      return { patch: { status: 'cancelled' }, from: ['scheduled', 'cancelling', 'authorized'] }
    case 'CANCELLATION_DENIED':
      return local === 'cancelling'
        ? {
            patch: { status: 'authorized', error: inv.error ?? 'Cancelamento negado pela prefeitura' },
            from: ['cancelling'],
          }
        : null
    default:
      return null
  }
}

async function reconcileInvoices(
  clinicId: string,
  provider: PaymentProvider,
  deps: ReconcileDeps,
  now: Date,
  res: ClinicReconcileResult,
  alive: () => boolean,
): Promise<void> {
  const stale = await deps.listStaleInvoices(clinicId, new Date(now.getTime() - INVOICE_MIN_AGE))
  for (const row of stale) {
    if (!alive()) return
    try {
      const t = invoiceTransition(row.status, await provider.getInvoice(row.providerInvoiceId))
      if (t && (await deps.events.updateInvoice(clinicId, row.providerInvoiceId, t.patch, t.from))) res.invoices++
    } catch (e) {
      if (isInvalidKey(e)) throw e
      console.error(`[cron/payments] nota ${row.providerInvoiceId}:`, errMsg(e))
      res.error ??= errMsg(e)
    }
  }
}

async function reconcileEvents(
  clinicId: string,
  deps: ReconcileDeps,
  now: Date,
  res: ClinicReconcileResult,
  alive: () => boolean,
): Promise<void> {
  const failed = await deps.listFailedEvents(
    clinicId,
    new Date(now.getTime() - EVENT_MIN_AGE),
    new Date(now.getTime() - EVENT_MAX_AGE),
  )
  for (const ev of failed) {
    if (!alive()) return
    try {
      if ((await reprocessEvent(ev, deps.events, now)) === 'processed') res.reprocessed++
    } catch (e) {
      if (isInvalidKey(e)) throw e
      console.error(`[cron/payments] evento ${ev.id}:`, errMsg(e))
      res.error ??= errMsg(e)
    }
  }
}

export async function reconcileAll(
  deps: ReconcileDeps,
  now: Date,
  deadline: Date,
): Promise<Record<string, ClinicReconcileResult>> {
  const clock = deps.clock ?? Date.now
  const out: Record<string, ClinicReconcileResult> = {}
  const clinics = await deps.listConnectedClinics()
  for (let i = 0; i < clinics.length; i++) {
    const clinicId = clinics[i]
    if (clock() >= deadline.getTime()) break
    // Cada clínica gasta no máximo uma fatia do tempo que resta, para uma lenta não esgotar as seguintes.
    const clinicEnd = clock() + (deadline.getTime() - clock()) / (clinics.length - i)
    const alive = () => clock() < clinicEnd
    const res: ClinicReconcileResult = { completed: 0, deleted: 0, updated: 0, invoices: 0, reprocessed: 0 }
    out[clinicId] = res
    try {
      const conn = await deps.getConnection(clinicId)
      if (!conn) continue
      await reconcileGroups(clinicId, conn.provider, deps, now, res, alive)
      await reconcileOpenPayments(clinicId, conn.provider, deps, now, res, alive)
      await reconcileInvoices(clinicId, conn.provider, deps, now, res, alive)
      await reconcileEvents(clinicId, deps, now, res, alive)
      await deps.purgeEvents(clinicId, new Date(now.getTime() - EVENT_RETENTION))
    } catch (e) {
      if (isInvalidKey(e)) {
        await deps.markInvalidKey(clinicId).catch((m) => console.error('[cron/payments] markInvalidKey:', errMsg(m)))
        res.error = 'asaas_invalid_key'
      } else {
        console.error(`[cron/payments] clínica ${clinicId}:`, errMsg(e))
        res.error = errMsg(e)
      }
    }
  }
  return out
}
