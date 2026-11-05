import { describe, expect, it } from 'vitest'
import { parseReply, pickConfirmationTarget, type SentConfirmation } from '@/lib/messaging/replies'

describe('parseReply', () => {
  it.each(['1', ' 1 ', 'Sim', 'confirmo', '1.'])('confirm: %j', (t) => {
    expect(parseReply(t)).toBe('confirm')
  })
  it.each(['2', 'Não', 'nao', 'cancelar'])('cancel: %j', (t) => {
    expect(parseReply(t)).toBe('cancel')
  })
  it.each(['12', 'pode ser às 15h?', '', 'sim, mas posso às 15h?'])('null: %j', (t) => {
    expect(parseReply(t)).toBeNull()
  })
})

const now = new Date('2026-11-03T13:00:00Z')

function cand(id: string, sentAt: string, start: string, status = 'scheduled', keyStart = start): SentConfirmation {
  return {
    message_id: `m-${id}`,
    appointment_id: id,
    sent_at: sentAt,
    dedupe_key: `confirmation:${id}:${new Date(keyStart).toISOString()}`,
    appointment: { start_time: start, status },
  }
}

describe('pickConfirmationTarget', () => {
  const future = '2026-11-04T14:00:00Z'

  it('returns null for empty list', () => {
    expect(pickConfirmationTarget([], now)).toBeNull()
  })
  it('picks the most recent sent_at among valid', () => {
    const a = cand('a', '2026-11-03T08:00:00Z', future)
    const b = cand('b', '2026-11-03T10:00:00Z', future, 'confirmed')
    expect(pickConfirmationTarget([a, b], now)).toBe(b)
  })
  it('ignores sent_at older than 48h', () => {
    const old = cand('a', '2026-11-01T12:59:00Z', future)
    expect(pickConfirmationTarget([old], now)).toBeNull()
  })
  it('ignores appointments already started', () => {
    expect(pickConfirmationTarget([cand('a', '2026-11-03T10:00:00Z', '2026-11-03T12:00:00Z')], now)).toBeNull()
  })
  it('ignores cancelled/completed', () => {
    const c = cand('a', '2026-11-03T10:00:00Z', future, 'cancelled')
    const d = cand('b', '2026-11-03T10:00:00Z', future, 'completed')
    expect(pickConfirmationTarget([c, d], now)).toBeNull()
  })
  it('ignores confirmation whose start_time no longer matches', () => {
    const moved = cand('a', '2026-11-03T11:00:00Z', future, 'scheduled', '2026-11-04T09:00:00Z')
    const ok = cand('b', '2026-11-03T08:00:00Z', future)
    expect(pickConfirmationTarget([moved], now)).toBeNull()
    expect(pickConfirmationTarget([moved, ok], now)).toBe(ok)
  })
})
