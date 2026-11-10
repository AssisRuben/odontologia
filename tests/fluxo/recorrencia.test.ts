import { describe, it, expect } from 'vitest'
import { mesDe, diaDe, rotuloMes } from '@/lib/fluxo/recorrencia'

describe('recorrencia', () => {
  it('mesDe devolve YYYY-MM', () => { expect(mesDe('2026-11-30')).toBe('2026-11') })
  it('diaDe devolve o dia', () => { expect(diaDe('2026-11-30')).toBe(30) })
  it('rotuloMes', () => { expect(rotuloMes('2026-02')).toBe('fevereiro/2026') })
})
