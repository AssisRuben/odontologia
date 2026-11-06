import type { LostReason } from '@/types'
import { LOST_REASONS } from './etapas'

type Fail = { ok: false; status: number; error: string }
const fail = (error: string): Fail => ({ ok: false, status: 422, error })

function validYmd(s: string | null): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** professionalId: undefined = todos, null = sem dentista, string = profissional. */
export function parseFunnelQuery(
  q: URLSearchParams,
): { ok: true; from: string; to: string; professionalId: string | null | undefined } | Fail {
  const from = q.get('de')
  const to = q.get('ate')
  if (!validYmd(from) || !validYmd(to) || from > to) return fail('Período inválido')
  const d = q.get('dentista')
  const professionalId = !d ? undefined : d === 'none' ? null : d
  return { ok: true, from, to, professionalId }
}

export type Decision =
  | { action: 'approve'; itemIds: string[] }
  | { action: 'lose'; reason: LostReason; note: string | null }
  | { action: 'reopen' }

export function parseDecision(body: unknown): { ok: true; decision: Decision } | Fail {
  if (!body || typeof body !== 'object') return fail('Ação inválida')
  const b = body as Record<string, unknown>
  if (b.action === 'reopen') return { ok: true, decision: { action: 'reopen' } }
  if (b.action === 'approve') {
    const ids = b.itemIds
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((i) => typeof i !== 'string')) {
      return fail('Selecione ao menos um item')
    }
    return { ok: true, decision: { action: 'approve', itemIds: ids as string[] } }
  }
  if (b.action === 'lose') {
    const reason = LOST_REASONS.find((r) => r.code === b.reason)?.code
    if (!reason) return fail('Escolha o motivo')
    const note = typeof b.note === 'string' ? b.note.trim().slice(0, 500) : ''
    return { ok: true, decision: { action: 'lose', reason, note: note || null } }
  }
  return fail('Ação inválida')
}
