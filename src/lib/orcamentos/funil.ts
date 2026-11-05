import type { BudgetStatus, LostReason } from '@/types'
import { todayYmd } from '@/lib/messaging/time'
import { toCents } from '@/lib/payments/money'
import { LOST_REASONS } from './etapas'

const TZ = 'America/Sao_Paulo'

export interface FunnelRow {
  id: string
  status: BudgetStatus
  sent_at: string | null
  decided_at: string | null
  total: number
  approved_total: number
  professional_id: string | null
  professional_name: string
  lost_reason: LostReason | null
}

interface Tot { count: number; cents: number }
export interface Funnel {
  presented: Tot
  approved: Tot
  rateCents: number | null
  rateCount: number | null
  avgDaysToApprove: number | null
  byProfessional: { id: string | null; name: string; presented: Tot; approved: Tot; rateCents: number | null }[]
  lostReasons: { code: LostReason; label: string; count: number }[]
}

const ymd = (iso: string) => todayYmd(new Date(iso), TZ)
function dayDiff(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number)
  const [y2, m2, d2] = b.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
}
const ratio = (num: number, den: number) => (den > 0 ? num / den : null)

export function buildFunnel(
  rows: FunnelRow[],
  filter: { from: string; to: string; professionalId?: string | null },
): Funnel {
  const inScope = rows.filter(r => {
    if (!r.sent_at) return false
    const d = ymd(r.sent_at)
    if (d < filter.from || d > filter.to) return false
    if (filter.professionalId && r.professional_id !== filter.professionalId) return false
    return true
  })

  const presented: Tot = { count: 0, cents: 0 }
  const approved: Tot = { count: 0, cents: 0 }
  const diffs: number[] = []
  const prof = new Map<string, { id: string | null; name: string; presented: Tot; approved: Tot }>()
  const lost = new Map<LostReason, number>()

  for (const r of inScope) {
    const key = r.professional_id ?? '__none__'
    let p = prof.get(key)
    if (!p) {
      p = {
        id: r.professional_id,
        name: r.professional_id ? r.professional_name : 'Sem dentista',
        presented: { count: 0, cents: 0 },
        approved: { count: 0, cents: 0 },
      }
      prof.set(key, p)
    }
    const total = toCents(r.total)
    presented.count++; presented.cents += total
    p.presented.count++; p.presented.cents += total

    if (r.status === 'approved' || r.status === 'completed') {
      const ap = toCents(r.approved_total)
      approved.count++; approved.cents += ap
      p.approved.count++; p.approved.cents += ap
      if (r.sent_at && r.decided_at) diffs.push(dayDiff(ymd(r.sent_at), ymd(r.decided_at)))
    } else if ((r.status === 'rejected' || r.status === 'expired') && r.lost_reason) {
      lost.set(r.lost_reason, (lost.get(r.lost_reason) ?? 0) + 1)
    }
  }

  const order = (c: LostReason) => LOST_REASONS.findIndex(l => l.code === c)
  return {
    presented,
    approved,
    rateCents: ratio(approved.cents, presented.cents),
    rateCount: ratio(approved.count, presented.count),
    avgDaysToApprove: diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null,
    byProfessional: [...prof.values()]
      .map(p => ({ ...p, rateCents: ratio(p.approved.cents, p.presented.cents) }))
      .sort((a, b) => b.presented.cents - a.presented.cents),
    lostReasons: [...lost.entries()]
      .map(([code, count]) => ({ code, label: LOST_REASONS[order(code)]?.label ?? code, count }))
      .sort((a, b) => b.count - a.count || order(a.code) - order(b.code)),
  }
}
