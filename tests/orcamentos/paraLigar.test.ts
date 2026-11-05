import { describe, it, expect } from 'vitest'
import { needsCall } from '@/lib/orcamentos/paraLigar'

const TZ = 'America/Sao_Paulo'
const now = new Date('2026-11-08T15:00:00-03:00')
const base = { status: 'sent' as const, sent_at: '2026-11-01T10:00:00-03:00', viewed_at: null, followup_at: null, link_created_at: null }

describe('needsCall', () => {
  it('lembretes [3,7]: link há 7 dias true, há 6 false', () => {
    expect(needsCall({ ...base, link_created_at: '2026-11-01T10:00:00-03:00' }, now, TZ, [3, 7])).toBe(true)
    expect(needsCall({ ...base, link_created_at: '2026-11-02T10:00:00-03:00' }, now, TZ, [3, 7])).toBe(false)
  })
  it('sem lembretes, 7 dias', () => {
    expect(needsCall(base, now, TZ, null)).toBe(true)
    expect(needsCall(base, now, TZ, [])).toBe(true)
    expect(needsCall({ ...base, sent_at: '2026-11-03T10:00:00-03:00' }, now, TZ, [])).toBe(false)
  })
  it('visualizado há 2 dias', () => {
    const b = { ...base, sent_at: '2026-11-07T10:00:00-03:00', viewed_at: '2026-11-06T10:00:00-03:00' }
    expect(needsCall(b, now, TZ, [3, 7])).toBe(true)
  })
  it('followup_at', () => {
    expect(needsCall({ ...base, followup_at: '2026-11-09T10:00:00-03:00' }, now, TZ, [3, 7])).toBe(false)
    expect(needsCall({ ...base, followup_at: '2026-11-08T08:00:00-03:00' }, now, TZ, [3, 7])).toBe(true)
  })
  it('status approved false', () => {
    expect(needsCall({ ...base, status: 'approved' }, now, TZ, [3, 7])).toBe(false)
  })
  it('needsCall uses clinic day', () => {
    const b = { ...base, sent_at: '2026-11-01T23:30:00-03:00' }
    expect(needsCall(b, new Date('2026-11-08T03:30:00Z'), TZ, [3, 7])).toBe(true)
  })
})
