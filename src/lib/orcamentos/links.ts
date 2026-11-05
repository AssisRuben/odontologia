import { randomBytes } from 'node:crypto'
import type { BudgetStatus } from '@/types'

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
  /** decided_at da assinatura (quando o orçamento foi aprovado), se houver. */
  signed_at: string | null
}

export interface LinkView {
  linkId: string
  budgetId: string
  clinicId: string
  status: BudgetStatus
  active: boolean
  lockedUntil: Date | null
  signedAt: Date | null
}

export interface LinkDeps {
  findByToken(token: string): Promise<LinkRecord | null>
  /** Soma 1 em failed_attempts e devolve o novo valor. */
  incrementFailed(linkId: string): Promise<number>
  /** Grava locked_until e zera failed_attempts. */
  lock(linkId: string, until: Date): Promise<void>
}

export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

export function linkUrl(token: string): string {
  return `${process.env.APP_URL ?? ''}/orcamento/${token}`
}

export async function resolveLink(token: string, deps: LinkDeps): Promise<LinkView | null> {
  if (!TOKEN_RE.test(token)) return null
  const r = await deps.findByToken(token)
  if (!r) return null
  return {
    linkId: r.id,
    budgetId: r.budget_id,
    clinicId: r.clinic_id,
    status: r.budget_status,
    active: r.revoked_at === null && r.budget_status === 'sent',
    lockedUntil: r.locked_until ? new Date(r.locked_until) : null,
    signedAt: r.signed_at ? new Date(r.signed_at) : null,
  }
}

export async function registerFailedAttempt(linkId: string, now: Date, deps: LinkDeps): Promise<{ locked: boolean }> {
  const count = await deps.incrementFailed(linkId)
  if (count < MAX_FAILED_ATTEMPTS) return { locked: false }
  await deps.lock(linkId, new Date(now.getTime() + LOCK_MS))
  return { locked: true }
}

export function isLocked(view: Pick<LinkView, 'lockedUntil'>, now: Date): boolean {
  return view.lockedUntil !== null && view.lockedUntil.getTime() > now.getTime()
}
