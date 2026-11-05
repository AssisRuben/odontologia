import { randomBytes } from 'node:crypto'
import type { BudgetStatus } from '@/types'
import { todayYmd } from '@/lib/messaging/time'

export const MAX_FAILED_ATTEMPTS = 5
export const LOCK_MS = 60 * 60 * 1000
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

export interface LinkRecord {
  id: string
  budget_id: string
  clinic_id: string
  revoked_at: string | null
  locked_until: string | null
  budget_status: BudgetStatus
  /** budgets.valid_until (YYYY-MM-DD). */
  valid_until: string | null
  /** decided_at da assinatura (quando o orçamento foi aprovado), se houver. */
  signed_at: string | null
  /** budget_signatures.link_id: link usado na assinatura (null = recepção ou sem assinatura). */
  signature_link_id: string | null
}

export interface LinkView {
  linkId: string
  budgetId: string
  clinicId: string
  status: BudgetStatus
  active: boolean
  validUntil: string | null
  lockedUntil: Date | null
  signedAt: Date | null
  signatureLinkId: string | null
}

export interface LinkDeps {
  findByToken(token: string): Promise<LinkRecord | null>
  /** Conta uma tentativa errada de forma atômica (RPC); true se o link ficou/estava bloqueado. */
  registerFailed(linkId: string, clinicId: string): Promise<boolean>
}

export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

export function linkUrl(token: string): string {
  return `${process.env.APP_URL ?? ''}/orcamento/${token}`
}

export async function resolveLink(token: string, deps: LinkDeps, now: Date = new Date()): Promise<LinkView | null> {
  if (!TOKEN_RE.test(token)) return null
  const r = await deps.findByToken(token)
  if (!r) return null
  return {
    linkId: r.id,
    budgetId: r.budget_id,
    clinicId: r.clinic_id,
    status: r.budget_status,
    active:
      r.revoked_at === null &&
      r.budget_status === 'sent' &&
      (r.valid_until === null || r.valid_until >= todayYmd(now, 'America/Sao_Paulo')),
    validUntil: r.valid_until,
    lockedUntil: r.locked_until ? new Date(r.locked_until) : null,
    signedAt: r.signed_at ? new Date(r.signed_at) : null,
    signatureLinkId: r.signature_link_id,
  }
}

export async function registerFailedAttempt(linkId: string, clinicId: string, _now: Date, deps: LinkDeps): Promise<{ locked: boolean }> {
  return { locked: await deps.registerFailed(linkId, clinicId) }
}

export function isLocked(view: Pick<LinkView, 'lockedUntil'>, now: Date): boolean {
  return view.lockedUntil !== null && view.lockedUntil.getTime() > now.getTime()
}
