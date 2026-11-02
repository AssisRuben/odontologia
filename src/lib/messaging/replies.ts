import { keyStartTime } from './schedule'

const CONFIRM = new Set(['1', 'sim', 'confirmo'])
const CANCEL = new Set(['2', 'nao', 'cancelar'])
const WINDOW_MS = 48 * 3_600_000

export function parseReply(text: string): 'confirm' | 'cancel' | null {
  const t = text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.!,]+$/, '')
    .trim()
  if (CONFIRM.has(t)) return 'confirm'
  if (CANCEL.has(t)) return 'cancel'
  return null
}

export interface SentConfirmation {
  message_id: string
  appointment_id: string
  sent_at: string
  dedupe_key: string
  appointment: { start_time: string; status: string }
}

function isValid(c: SentConfirmation, now: Date): boolean {
  if (new Date(c.sent_at).getTime() < now.getTime() - WINDOW_MS) return false
  if (c.appointment.status !== 'scheduled' && c.appointment.status !== 'confirmed') return false
  const start = new Date(c.appointment.start_time)
  if (!(start.getTime() > now.getTime())) return false
  const keyStart = keyStartTime(c.dedupe_key)
  if (keyStart === null) return false
  const keyDate = new Date(keyStart)
  return !isNaN(keyDate.getTime()) && keyDate.toISOString() === start.toISOString()
}

export function pickConfirmationTarget(candidates: SentConfirmation[], now: Date): SentConfirmation | null {
  let best: SentConfirmation | null = null
  for (const c of candidates) {
    if (!isValid(c, now)) continue
    if (best === null || new Date(c.sent_at).getTime() > new Date(best.sent_at).getTime()) best = c
  }
  return best
}
