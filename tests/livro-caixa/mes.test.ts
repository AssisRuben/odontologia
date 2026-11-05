import { describe, it, expect } from 'vitest'
import { parseMonth, monthRange, shiftMonth, monthLabel, inMonth } from '@/lib/livro-caixa/mes'

describe('mes', () => {
  it('parseMonth', () => {
    expect(parseMonth('2026-13')).toBeNull()
    expect(parseMonth('2026-1')).toBeNull()
    expect(parseMonth('abc')).toBeNull()
    expect(parseMonth('2026-11')).toEqual({ year: 2026, month: 11 })
  })

  it('monthRange', () => {
    expect(monthRange('2026-02')).toEqual({ first: '2026-02-01', last: '2026-02-28' })
    expect(monthRange('2028-02').last).toBe('2028-02-29')
    expect(monthRange('2026-12').last).toBe('2026-12-31')
  })

  it('shiftMonth', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-05', 0)).toBe('2026-05')
  })

  it('monthLabel', () => {
    expect(monthLabel('2026-03')).toBe('março de 2026')
    expect(monthLabel('2026-11')).toBe('novembro de 2026')
  })

  it('inMonth', () => {
    expect(inMonth('2026-11-30', '2026-11')).toBe(true)
    expect(inMonth('2026-12-01', '2026-11')).toBe(false)
    expect(inMonth(null, '2026-11')).toBe(false)
  })
})
