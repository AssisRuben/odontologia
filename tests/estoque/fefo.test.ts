import { describe, it, expect } from 'vitest'
import { ordemFefo, planoSaida } from '@/lib/estoque/fefo'
import type { InventoryLot } from '@/types'

const lote = (id: string, quantity: number, expires_at: string | null, created_at = '2026-01-01T00:00:00Z'): InventoryLot => ({
  id, item_id: 'i', lot_code: null, expires_at, quantity, created_at,
})

describe('FEFO', () => {
  it('ordena por validade, sem validade por último', () => {
    const r = ordemFefo([lote('C', 4, null), lote('A', 10, '2027-01-15'), lote('B', 5, '2026-12-10')])
    expect(r.map((l) => l.id)).toEqual(['B', 'A', 'C'])
  })
  it('empate de validade usa created_at', () => {
    const r = ordemFefo([lote('X', 1, '2027-01-01', '2026-03-01T00:00:00Z'), lote('Y', 1, '2027-01-01', '2026-02-01T00:00:00Z')])
    expect(r.map((l) => l.id)).toEqual(['Y', 'X'])
  })
  it('não altera o array de entrada', () => {
    const e = [lote('C', 4, null), lote('B', 5, '2026-12-10')]
    ordemFefo(e)
    expect(e.map((l) => l.id)).toEqual(['C', 'B'])
  })
  it('saída atravessa lotes e deixa o sem validade intocado', () => {
    const lotes = [lote('A', 10, '2027-01-15'), lote('B', 5, '2026-12-10'), lote('C', 4, null)]
    expect(planoSaida(lotes, 12)).toEqual([{ lotId: 'B', quantidade: 5 }, { lotId: 'A', quantidade: 7 }])
  })
  it('saldo insuficiente retorna null', () => {
    const lotes = [lote('A', 10, '2027-01-15'), lote('B', 5, '2026-12-10'), lote('C', 4, null)]
    expect(planoSaida(lotes, 19)).toEqual([
      { lotId: 'B', quantidade: 5 }, { lotId: 'A', quantidade: 10 }, { lotId: 'C', quantidade: 4 },
    ])
    expect(planoSaida(lotes, 20)).toBeNull()
  })
  it('pularVencidos ignora lote vencido', () => {
    const lotes = [lote('V', 5, '2026-10-01'), lote('A', 5, '2027-01-01'), lote('N', 5, null)]
    const o = { hojeYmd: '2026-11-10', pularVencidos: true }
    expect(planoSaida(lotes, 7, o)).toEqual([{ lotId: 'A', quantidade: 5 }, { lotId: 'N', quantidade: 2 }])
    expect(planoSaida(lotes, 11, o)).toBeNull()
  })
  it('sem a flag o lote vencido é usado', () => {
    const lotes = [lote('V', 5, '2026-10-01'), lote('A', 5, '2027-01-01')]
    expect(planoSaida(lotes, 7, { hojeYmd: '2026-11-10', pularVencidos: false })).toEqual([{ lotId: 'V', quantidade: 5 }, { lotId: 'A', quantidade: 2 }])
  })
  it('só estoque vencido com pularVencidos retorna null', () => {
    expect(planoSaida([lote('V', 5, '2026-10-01')], 1, { hojeYmd: '2026-11-10', pularVencidos: true })).toBeNull()
  })
  it('lote com saldo 0 é ignorado', () => {
    const lotes = [lote('Z', 0, '2026-01-01'), lote('A', 3, '2027-01-01')]
    expect(planoSaida(lotes, 2)).toEqual([{ lotId: 'A', quantidade: 2 }])
  })
  it('quantidade inválida retorna null', () => {
    expect(planoSaida([lote('A', 3, null)], 0)).toBeNull()
  })
})
