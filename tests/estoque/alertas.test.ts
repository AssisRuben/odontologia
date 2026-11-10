import { describe, it, expect } from 'vitest'
import { alertasDoItem, resumoAlertas } from '@/lib/estoque/alertas'
import type { InventoryItem, InventoryLot } from '@/types'

const H = '2026-11-10'
const lote = (id: string, quantity: number, expires_at: string | null): InventoryLot => ({
  id, item_id: 'i', lot_code: null, expires_at, quantity, created_at: '2026-01-01T00:00:00Z',
})
const item = (p: Partial<InventoryItem>): InventoryItem => ({
  id: 'i', clinic_id: 'c', name: 'Luvas', quantity: 50, min_quantity: 20, created_at: '2026-01-01T00:00:00Z',
  active: true, tracks_expiry: true, ...p,
})

describe('alertas', () => {
  it('baixo quando quantity <= min', () => {
    expect(alertasDoItem(item({ quantity: 20, min_quantity: 20 }), H).baixo).toBe(true)
    expect(alertasDoItem(item({ quantity: 21, min_quantity: 20 }), H).baixo).toBe(false)
  })
  it('só conta lotes com saldo', () => {
    const i = item({ lots: [lote('a', 3, '2026-11-01'), lote('b', 0, '2026-11-15'), lote('c', 2, '2026-11-20'), lote('d', 1, null)] })
    expect(alertasDoItem(i, H)).toMatchObject({ vencidos: 1, vencendo: 1 })
    expect(alertasDoItem(item({ lots: [lote('a', 3, '2026-11-01'), lote('b', 0, '2026-11-15')] }), H)).toMatchObject({ vencidos: 1, vencendo: 0 })
  })
  it('sem lots', () => {
    expect(alertasDoItem(item({}), H)).toEqual({ baixo: false, vencidos: 0, vencendo: 0 })
  })
  it('resumo só de ativos', () => {
    const itens = [
      item({ id: '1', quantity: 1, lots: [lote('a', 1, '2026-11-01')] }),
      item({ id: '2', quantity: 1, active: false, lots: [lote('b', 1, '2026-11-01')] }),
      item({ id: '3', lots: [lote('c', 1, '2026-11-12')] }),
    ]
    expect(resumoAlertas(itens, H)).toEqual({ baixo: 1, vencidos: 1, vencendo: 1 })
  })
})
