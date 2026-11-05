import { timingSafeEqual } from 'node:crypto'

/** Confere o header Authorization contra `Bearer ${CRON_SECRET}` em tempo constante. */
export function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret || !header) return false
  const a = Buffer.from(header)
  const b = Buffer.from(`Bearer ${secret}`)
  return a.length === b.length && timingSafeEqual(a, b)
}
