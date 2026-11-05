import type { LostReason } from '@/types'
import { resolveLink, registerFailedAttempt, isLocked, type LinkDeps } from './links'
import { approveBudget, rejectBudget, type ApprovalDeps } from './aprovacao'
import { checkSignerCpf } from './assinatura'
import { LOST_REASONS } from './etapas'

export const LOCK_MESSAGE = 'Muitas tentativas. Tente de novo em 1 hora ou fale com a clínica.'
export const UNAVAILABLE_MESSAGE = 'Este link não está mais disponível. Fale com a clínica.'
const DECIDED_MESSAGE = 'Este orçamento já foi respondido.'
const DOWNLOAD_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export interface OpenBudget {
  clinic: { name: string; logoUrl: string | null }
  professional: string | null
  number: string
  createdAt: string
  validUntil: string | null
  items: { id: string; procedure: string; tooth: string | null; quantity: number; unitPrice: number }[]
}

export type PublicViewResult =
  | { kind: 'unavailable' }
  | { kind: 'approved'; signedAt: string | null; canDownload: boolean }
  | ({ kind: 'open' } & OpenBudget)

export interface PublicDeps extends LinkDeps {
  /** Dados exibíveis do orçamento (sem CPF, telefone ou e-mail). */
  loadOpen(budgetId: string, clinicId: string): Promise<OpenBudget | null>
  /** CPFs cadastrados (só uso interno, nunca devolvidos). */
  patientCpfs(budgetId: string, clinicId: string): Promise<{ cpf: string | null; payerCpf: string | null } | null>
  /** Soma 1 em view_count e devolve o valor anterior. */
  bumpView(linkId: string, clinicId: string): Promise<number>
  /** Grava budgets.viewed_at se ainda estiver vazio. */
  markViewed(budgetId: string, clinicId: string, now: Date): Promise<void>
  addViewedEvent(budgetId: string, clinicId: string): Promise<void>
}

export type PublicResponse = { status: number; body: Record<string, unknown> }

/** Comprovante público: orçamento aprovado por este link, até 30 dias após a assinatura. */
export function receiptAvailable(
  view: { status: string; linkId: string; signatureLinkId: string | null; signedAt: Date | null },
  now: Date,
): boolean {
  return (
    (view.status === 'approved' || view.status === 'completed') &&
    view.signatureLinkId === view.linkId &&
    canDownloadReceipt(view.signedAt, now)
  )
}

export function canDownloadReceipt(signedAt: Date | null, now: Date): boolean {
  return signedAt !== null && now.getTime() - signedAt.getTime() <= DOWNLOAD_WINDOW_MS
}

export async function publicView(token: string, now: Date, deps: PublicDeps): Promise<PublicViewResult> {
  const view = await resolveLink(token, deps, now)
  if (!view) return { kind: 'unavailable' }
  if (view.status === 'approved' || view.status === 'completed') {
    // só o link que assinou (nunca um link revogado por reenvio) mostra a aprovação
    if (view.signatureLinkId !== view.linkId) return { kind: 'unavailable' }
    // a exceção do link encerrado dura 30 dias após a assinatura
    if (!view.signedAt || !canDownloadReceipt(view.signedAt, now)) return { kind: 'unavailable' }
    return { kind: 'approved', signedAt: view.signedAt.toISOString(), canDownload: true }
  }
  if (!view.active) return { kind: 'unavailable' }
  const open = await deps.loadOpen(view.budgetId, view.clinicId)
  if (!open) return { kind: 'unavailable' }
  return { kind: 'open', ...open }
}

/** Registra a abertura do link. Devolve false se o link não está ativo. */
export async function recordView(token: string, now: Date, deps: PublicDeps): Promise<boolean> {
  const view = await resolveLink(token, deps, now)
  if (!view || !view.active) return false
  const before = await deps.bumpView(view.linkId, view.clinicId)
  await deps.markViewed(view.budgetId, view.clinicId, now)
  if (before === 0) await deps.addViewedEvent(view.budgetId, view.clinicId)
  return true
}

/** Primeiro valor de x-forwarded-for, aparado e cortado em 300. */
export function clientIp(forwardedFor: string | null): string | null {
  const first = forwardedFor?.split(',')[0]?.trim()
  return first ? first.slice(0, 300) : null
}

const err = (status: number, error: string): PublicResponse => ({ status, body: { error } })

function unavailable(status: string | null): PublicResponse {
  return status === 'approved' || status === 'rejected' || status === 'expired' || status === 'completed'
    ? err(409, DECIDED_MESSAGE)
    : err(404, UNAVAILABLE_MESSAGE)
}

export async function signPublic(
  token: string,
  raw: unknown,
  ctx: { ip: string | null; userAgent: string | null; now: Date },
  deps: PublicDeps & ApprovalDeps,
): Promise<PublicResponse> {
  const view = await resolveLink(token, deps, ctx.now)
  if (!view || !view.active) return unavailable(view?.status ?? null)
  if (isLocked(view, ctx.now)) return err(429, LOCK_MESSAGE)

  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (b.agreed !== true) return err(422, 'Confirme que leu e concorda com os itens selecionados')

  const itemIds = Array.isArray(b.itemIds) ? b.itemIds.filter((x): x is string => typeof x === 'string') : []
  const patient = await deps.patientCpfs(view.budgetId, view.clinicId)
  const cpfCheck = checkSignerCpf(typeof b.cpf === 'string' ? b.cpf : '', patient?.cpf ?? null, patient?.payerCpf ?? null)
  if (!cpfCheck.ok) {
    if (cpfCheck.error !== 'CPF inválido') {
      const { locked } = await registerFailedAttempt(view.linkId, view.clinicId, ctx.now, deps)
      if (locked) return err(429, LOCK_MESSAGE)
    }
    return err(422, cpfCheck.error)
  }

  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (name.length < 3) return err(422, 'Informe o nome completo')

  const r = await approveBudget(
    {
      budgetId: view.budgetId, clinicId: view.clinicId, linkId: view.linkId, itemIds,
      signer: { name: name.slice(0, 200), cpf: cpfCheck.cpf }, actorId: null,
      ip: ctx.ip, userAgent: ctx.userAgent, now: ctx.now,
    },
    deps,
  )
  return r.ok ? { status: 200, body: { ok: true } } : err(r.status, r.error)
}

export async function declinePublic(token: string, now: Date, raw: unknown, deps: PublicDeps & ApprovalDeps): Promise<PublicResponse> {
  const view = await resolveLink(token, deps, now)
  if (!view || !view.active) return unavailable(view?.status ?? null)
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const reason = LOST_REASONS.find((r) => r.code === b.reason)?.code ?? null
  const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 500) : null
  const r = await rejectBudget(
    { budgetId: view.budgetId, clinicId: view.clinicId, linkId: view.linkId, reason: reason as LostReason | null, note, actorId: null, status: 'rejected' },
    deps,
  )
  return r.ok ? { status: 200, body: { ok: true } } : err(r.status, r.error)
}
