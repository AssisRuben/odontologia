import { describe, it, expect } from 'vitest'
import { periodoDe, proximoPeriodo, prazo, diasEntre } from '@/lib/convenios/periodo'

describe('periodo', () => {
  it('virada de mês e de ano', () => {
    expect(periodoDe('2026-01-29', 28)).toEqual({ start: '2026-01-29', end: '2026-02-28' })
    expect(periodoDe('2026-12-30', 28)).toEqual({ start: '2026-12-29', end: '2027-01-28' })
    expect(periodoDe('2026-03-10', 10)).toEqual({ start: '2026-02-11', end: '2026-03-10' })
    expect(periodoDe('2026-03-05', 10)).toEqual({ start: '2026-02-11', end: '2026-03-10' })
    expect(periodoDe('2026-01-05', 10)).toEqual({ start: '2025-12-11', end: '2026-01-10' })
  })
  it('próximo período', () => {
    expect(proximoPeriodo('2026-03-10', 10)).toEqual({ start: '2026-03-11', end: '2026-04-10' })
    expect(proximoPeriodo('2026-12-10', 10)).toEqual({ start: '2026-12-11', end: '2027-01-10' })
  })
  it('prazo e diasEntre', () => {
    expect(prazo('2026-03-10', 10)).toBe('2026-03-20')
    expect(prazo('2026-03-25', 10)).toBe('2026-04-04')
    expect(diasEntre('2026-03-10', '2026-03-13')).toBe(3)
    expect(diasEntre('2026-03-13', '2026-03-10')).toBe(-3)
  })
})
