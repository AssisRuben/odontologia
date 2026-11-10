import { describe, it, expect } from 'vitest'
import { mesAno, dataBr, rotuloLote } from '@/lib/estoque/formatar'

describe('formatar', () => {
  it('mesAno e dataBr', () => {
    expect(mesAno('2027-03-15')).toBe('03/2027')
    expect(dataBr('2027-03-15')).toBe('15/03/2027')
  })
  it('rotuloLote', () => {
    expect(rotuloLote({ lot_code: 'A23', expires_at: '2027-03-01' })).toBe('Lote A23 (vence 03/2027)')
    expect(rotuloLote({ lot_code: null, expires_at: null })).toBe('Lote sem lote')
  })
})
