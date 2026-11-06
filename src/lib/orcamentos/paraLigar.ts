import type { BudgetStatus } from '@/types'
import { todayYmd } from '@/lib/messaging/time'

function dayDiff(fromYmd: string, toYmd: string): number {
  const [a, b, c] = fromYmd.split('-').map(Number)
  const [x, y, z] = toYmd.split('-').map(Number)
  return Math.round((Date.UTC(x, y - 1, z) - Date.UTC(a, b - 1, c)) / 86400000)
}

const ymd = (iso: string, tz: string) => todayYmd(new Date(iso), tz)

export function needsCall(
  b: {
    status: BudgetStatus
    sent_at: string | null
    viewed_at: string | null
    followup_at: string | null
    link_created_at: string | null
  },
  now: Date,
  tz: string,
  reminderDays: number[] | null,
): boolean {
  if (b.status !== 'sent') return false
  const today = todayYmd(now, tz)
  if (b.followup_at && b.followup_at.slice(0, 10) > today) return false

  const baseIso = b.link_created_at ?? b.sent_at
  if (baseIso) {
    const days = reminderDays && reminderDays.length > 0 ? Math.max(...reminderDays) : 7
    if (dayDiff(ymd(baseIso, tz), today) >= days) return true
  }
  if (b.viewed_at && dayDiff(ymd(b.viewed_at, tz), today) >= 2) return true
  return false
}
