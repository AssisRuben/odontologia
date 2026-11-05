import { toApiError } from './connection'
import type { PaymentProvider } from './provider'
import { applyProviderStatus, type LocalStatus } from './status'
import type { PaymentMethod } from '@/types'

export interface ActionPayment {
  id: string
  status: LocalStatus
  dueDate: string | null
  amountCents: number
  /** 'YYYY-MM-DD' */
  paidAt: string | null
  netAmountCents: number | null
  providerChargeId: string | null
  providerInstallmentId: string | null
  providerState: 'creating' | 'active' | null
  chargeGroupId: string | null
  chargeKind: 'manual' | 'avulsa' | 'carne' | 'cartao_parcelado'
  hasAuthorizedInvoice: boolean
}

export interface RowPatch {
  status?: LocalStatus
  due_date?: string
  /** 'YYYY-MM-DD' */
  paid_at?: string | null
  payment_method?: PaymentMethod
  net_amount_cents?: number | null
  amount_cents?: number
}

export interface ActionDeps {
  getPayment(clinicId: string, paymentId: string): Promise<ActionPayment | null>
  getConnection(clinicId: string): Promise<{ provider: PaymentProvider; connection: { nfse_auto: boolean } } | null>
  /** Linhas do grupo ainda em aberto (pending/overdue). */
  listUnpaidInGroup(clinicId: string, groupId: string): Promise<string[]>
  /** Só altera linhas ainda pending/overdue; devolve quantas foram alteradas. */
  updateRows(clinicId: string, ids: string[], patch: RowPatch): Promise<number>
  markInvalidKey(clinicId: string): Promise<void>
  today(clinicId: string, now: Date): Promise<string>
  /** Emissão automática da nota (a mesma do webhook); lança em caso de falha. */
  scheduleInvoice(clinicId: string, paymentId: string): Promise<void>
}

export type ActionResult =
  | { status: 200; body: { ok: true; ids: string[] } }
  | { status: number; body: { error: string } }

const fail = (status: number, error: string) => ({ status, body: { error } })
const NOT_FOUND = 'Pagamento não encontrado'
const CREATING = 'Cobrança ainda sendo criada. Aguarde alguns minutos.'
const NOT_OPEN = 'Este lançamento não está em aberto'

function isRealDate(ymd: unknown): ymd is string {
  if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

const isOpen = (p: ActionPayment) => p.status === 'pending' || p.status === 'overdue'

async function connectionFor(clinicId: string, p: ActionPayment, deps: ActionDeps) {
  if (!p.providerChargeId) return null
  return (await deps.getConnection(clinicId)) ?? undefined
}

async function providerFor(clinicId: string, p: ActionPayment, deps: ActionDeps) {
  const conn = await connectionFor(clinicId, p, deps)
  return conn ? conn.provider : conn
}

async function providerFailure(clinicId: string, e: unknown, deps: ActionDeps, tag: string): Promise<ActionResult> {
  const err = toApiError(e)
  if (err.status === 409) await deps.markInvalidKey(clinicId).catch(() => {})
  else if (err.status === 500) console.error(`[payments/${tag}] falha no Asaas:`, (e as Error).message)
  return fail(err.status, err.error)
}

const NO_CONNECTION = 'Conecte o Asaas em Configurações → Pagamentos'

export async function changeDueDate(
  clinicId: string, paymentId: string, dueDate: string, deps: ActionDeps, now: Date,
): Promise<ActionResult> {
  const p = await deps.getPayment(clinicId, paymentId)
  if (!p) return fail(404, NOT_FOUND)
  if (p.providerState === 'creating') return fail(409, CREATING)
  if (!isOpen(p)) return fail(409, 'Só é possível alterar cobranças em aberto')
  if (!isRealDate(dueDate)) return fail(422, 'Data de vencimento inválida')
  const today = await deps.today(clinicId, now)
  if (dueDate < today) return fail(422, 'A data de vencimento não pode estar no passado')

  const patch: RowPatch = { due_date: dueDate, status: 'pending' }
  const provider = await providerFor(clinicId, p, deps)
  if (provider === undefined) return fail(409, NO_CONNECTION)
  if (provider) {
    try {
      const charge = await provider.updateDueDate(p.providerChargeId!, dueDate)
      const applied = applyProviderStatus(
        {
          status: p.status, due_date: p.dueDate, hasAuthorizedInvoice: p.hasAuthorizedInvoice,
          net_amount_cents: p.netAmountCents, paid_at: p.paidAt, amount_cents: p.amountCents,
        },
        charge,
        today,
      )
      if (applied?.amount_cents !== undefined) patch.amount_cents = applied.amount_cents
    } catch (e) {
      return providerFailure(clinicId, e, deps, 'due-date')
    }
  }
  if ((await deps.updateRows(clinicId, [p.id], patch)) === 0) return fail(409, NOT_OPEN)
  return { status: 200, body: { ok: true, ids: [p.id] } }
}

export async function markReceived(
  clinicId: string,
  paymentId: string,
  input: { paidAt: string; amountCents: number; method?: PaymentMethod },
  deps: ActionDeps,
  now: Date = new Date(),
): Promise<ActionResult> {
  const p = await deps.getPayment(clinicId, paymentId)
  if (!p) return fail(404, NOT_FOUND)
  if (p.providerState === 'creating') return fail(409, CREATING)
  if (!isOpen(p)) return fail(409, NOT_OPEN)
  if (p.chargeKind === 'cartao_parcelado') {
    return fail(409, 'Pagamento no cartão não pode ser marcado como recebido em dinheiro')
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return fail(422, 'Valor inválido')
  if (!isRealDate(input.paidAt) || input.paidAt > (await deps.today(clinicId, now))) {
    return fail(422, 'Data de pagamento inválida')
  }

  const conn = await connectionFor(clinicId, p, deps)
  if (conn === undefined) return fail(409, NO_CONNECTION)
  if (conn) {
    try {
      await conn.provider.receiveInCash(p.providerChargeId!, input.paidAt, input.amountCents)
    } catch (e) {
      return providerFailure(clinicId, e, deps, 'receive')
    }
  }
  const patch: RowPatch = { status: 'paid', paid_at: input.paidAt }
  if (input.method) patch.payment_method = input.method
  if ((await deps.updateRows(clinicId, [p.id], patch)) === 0) return fail(409, NOT_OPEN)
  // O webhook do Asaas chega com o lançamento já pago e não emite a nota: emite aqui.
  if (conn?.connection.nfse_auto) {
    try {
      await deps.scheduleInvoice(clinicId, p.id)
    } catch (e) {
      // A baixa foi gravada; a nota pode ser emitida manualmente.
      console.error('[payments/receive] nota automática:', e instanceof Error ? e.message : 'Erro desconhecido')
    }
  }
  return { status: 200, body: { ok: true, ids: [p.id] } }
}

export async function cancelPayment(
  clinicId: string, paymentId: string, scope: 'one' | 'remaining', deps: ActionDeps,
): Promise<ActionResult> {
  const p = await deps.getPayment(clinicId, paymentId)
  if (!p) return fail(404, NOT_FOUND)
  if (p.providerState === 'creating') return fail(409, CREATING)
  if (p.status === 'paid') {
    return fail(409, 'Pagamento recebido não pode ser cancelado. Faça o estorno no painel do Asaas.')
  }
  if (!isOpen(p)) return fail(409, NOT_OPEN)

  // Com cobrança no Asaas sem parcelamento, 'restantes' vale só para este lançamento.
  const remaining = scope === 'remaining' && !!p.chargeGroupId && (!p.providerChargeId || !!p.providerInstallmentId)
  const provider = await providerFor(clinicId, p, deps)
  if (provider === undefined) return fail(409, NO_CONNECTION)
  if (provider) {
    try {
      if (remaining && p.providerInstallmentId) await provider.cancelInstallment(p.providerInstallmentId)
      else await provider.cancelCharge(p.providerChargeId!)
    } catch (e) {
      return providerFailure(clinicId, e, deps, 'cancel')
    }
  }
  const ids = remaining ? await deps.listUnpaidInGroup(clinicId, p.chargeGroupId!) : [p.id]
  if (!ids.includes(p.id)) ids.push(p.id)
  if ((await deps.updateRows(clinicId, ids, { status: 'cancelled' })) === 0) return fail(409, NOT_OPEN)
  return { status: 200, body: { ok: true, ids } }
}
