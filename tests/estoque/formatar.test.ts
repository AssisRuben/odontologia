import { describe, it, expect } from 'vitest'
import { mesAno, dataBr, rotuloLote, umAnoAntes } from '@/lib/estoque/formatar'

describe('formatar', () => {
  it('mesAno e dataBr', () => {
    expect(mesAno('2027-03-15')).toBe('03/2027')
    expect(dataBr('2027-03-15')).toBe('15/03/2027')
  })
  it('umAnoAntes', () => {
    expect(umAnoAntes('2026-11-10')).toBe('2025-11-10')
    expect(umAnoAntes('2028-02-29')).toBe('2027-03-01')
  })
  it('rotuloLote', () => {
    expect(rotuloLote({ lot_code: 'A23', expires_at: '2027-03-01' })).toBe('Lote A23 (vence 03/2027)')
    expect(rotuloLote({ lot_code: null, expires_at: null })).toBe('Lote sem lote')
  })
})
