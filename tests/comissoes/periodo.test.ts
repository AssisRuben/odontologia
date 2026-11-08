import { describe, it, expect } from 'vitest'
import { mesValido, mesDe, primeiroDia, ultimoDia, mesAnterior, mesEncerrado, rotuloMes } from '@/lib/comissoes/periodo'

describe('periodo', () => {
  it('ultimoDia considera bissexto', () => {
    expect(ultimoDia('2026-02')).toBe('2026-02-28')
    expect(ultimoDia('2028-02')).toBe('2028-02-29')
    expect(ultimoDia('2026-11')).toBe('2026-11-30')
  })
  it('mesAnterior vira o ano', () => {
    expect(mesAnterior('2026-01')).toBe('2025-12')
    expect(mesAnterior('2026-11')).toBe('2026-10')
  })
  it('mesEncerrado', () => {
    expect(mesEncerrado('2026-11', '2026-11-30')).toBe(false)
    expect(mesEncerrado('2026-10', '2026-11-01')).toBe(true)
  })
  it('mesValido', () => {
    expect(mesValido('2026-13')).toBe(false)
    expect(mesValido('2026-00')).toBe(false)
    expect(mesValido(5)).toBe(false)
    expect(mesValido('2026-12')).toBe(true)
  })
  it('mesDe, primeiroDia e rotuloMes', () => {
    expect(mesDe('2026-11-08')).toBe('2026-11')
    expect(primeiroDia('2026-11')).toBe('2026-11-01')
    expect(rotuloMes('2026-11')).toBe('11/2026')
  })
})
