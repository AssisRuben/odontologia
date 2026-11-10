import { describe, it, expect } from 'vitest'
import { diasDeAtraso } from '@/lib/protese/atraso'
import { todayYmd } from '@/lib/messaging/time'

describe('diasDeAtraso', () => {
  it('no dia da previsão não é atraso; depois conta dias', () => {
    expect(diasDeAtraso({ status: 'sent_to_lab', expected_at: '2026-11-20' }, '2026-11-20')).toBe(0)
    expect(diasDeAtraso({ status: 'sent_to_lab', expected_at: '2026-11-20' }, '2026-11-21')).toBe(1)
    expect(diasDeAtraso({ status: 'sent_to_lab', expected_at: '2026-11-20' }, '2026-11-22')).toBe(2)
    expect(diasDeAtraso({ status: 'sent_to_lab', expected_at: '2026-11-20' }, '2026-11-10')).toBe(0)
  })
  it('só atrasa enquanto solicitada ou no lab', () => {
    expect(diasDeAtraso({ status: 'returned', expected_at: '2026-11-01' }, '2026-11-10')).toBe(0)
    expect(diasDeAtraso({ status: 'installed', expected_at: '2026-11-01' }, '2026-11-10')).toBe(0)
    expect(diasDeAtraso({ status: 'requested', expected_at: '2026-11-01' }, '2026-11-10')).toBe(9)
  })
  it('sem previsão não atrasa', () => {
    expect(diasDeAtraso({ status: 'sent_to_lab' }, '2026-11-10')).toBe(0)
    expect(diasDeAtraso({ status: 'sent_to_lab', expected_at: null }, '2026-11-10')).toBe(0)
  })
  it('à meia-noite UTC o dia ainda é o de São Paulo', () => {
    const hoje = todayYmd(new Date('2026-11-10T02:00:00Z'), 'America/Sao_Paulo')
    expect(hoje).toBe('2026-11-09')
    expect(diasDeAtraso({ status: 'requested', expected_at: '2026-11-09' }, hoje)).toBe(0)
  })
})
