import type { MessagingConfig } from './types'

export const DEFAULT_MESSAGING_CONFIG: MessagingConfig = {
  window_start: '08:00',
  window_end: '20:00',
  daily_limit: 300,
  timezone: 'America/Sao_Paulo',
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

function validTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Lê clinics.messaging_config do banco com padrões e validação: nunca confia no JSON salvo. */
export function normalizeMessagingConfig(raw: unknown): MessagingConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_MESSAGING_CONFIG

  const hhmm = (v: unknown, fallback: string) => (typeof v === 'string' && HHMM.test(v) ? v : fallback)
  let window_start = hhmm(r.window_start, d.window_start)
  let window_end = hhmm(r.window_end, d.window_end)
  if (window_start >= window_end) {
    window_start = d.window_start
    window_end = d.window_end
  }

  let daily_limit = d.daily_limit
  const n = typeof r.daily_limit === 'string' ? Number(r.daily_limit) : r.daily_limit
  if (typeof n === 'number' && Number.isFinite(n)) {
    daily_limit = Math.min(1000, Math.max(1, Math.round(n)))
  }

  const timezone = validTimezone(r.timezone) ? r.timezone : d.timezone

  return { window_start, window_end, daily_limit, timezone }
}
