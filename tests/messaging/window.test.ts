import { describe, it, expect } from 'vitest'
import { isWithinSendWindow, startOfClinicDay, windowStartToday } from '@/lib/messaging/window'
import type { MessagingConfig } from '@/lib/messaging/types'

const cfg: MessagingConfig = {
  window_start: '08:00',
  window_end: '20:00',
  daily_limit: 100,
  timezone: 'America/Sao_Paulo',
}

describe('isWithinSendWindow', () => {
  it.each([
    ['2026-11-04T10:59:00Z', false],
    ['2026-11-04T11:00:00Z', true],
    ['2026-11-04T22:59:00Z', true],
    ['2026-11-04T23:00:00Z', false],
    ['2026-11-05T01:00:00Z', false],
  ])('%s -> %s', (iso, expected) => {
    expect(isWithinSendWindow(new Date(iso), cfg)).toBe(expected)
  })
})

describe('startOfClinicDay', () => {
  it('retorna 00:00 do dia da clínica em UTC', () => {
    expect(startOfClinicDay(new Date('2026-11-05T01:00:00Z'), cfg.timezone).toISOString()).toBe(
      '2026-11-04T03:00:00.000Z',
    )
  })
})

describe('windowStartToday', () => {
  it('retorna o início da janela de hoje no fuso da clínica', () => {
    expect(windowStartToday(new Date('2026-11-05T01:00:00Z'), cfg).toISOString()).toBe(
      '2026-11-04T11:00:00.000Z',
    )
  })
})
