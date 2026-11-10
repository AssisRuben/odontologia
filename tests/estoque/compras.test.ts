import { describe, it, expect } from 'vitest'
import { sugestaoCompra, listaDeCompras, textoListaCompras } from '@/lib/estoque/compras'
import type { InventoryItem } from '@/types'

const item = (p: Partial<InventoryItem>): InventoryItem => ({
  id: p.name ?? 'i', clinic_id: 'c', name: 'Luvas', quantity: 0, min_quantity: 20, created_at: '2026-01-01T00:00:00Z',
  active: true, tracks_expiry: false, ...p,
})

describe('sugestaoCompra', () => {
  it('usa ideal, ou 2x o mínimo', () => {
    expect(sugestaoCompra(item({ quantity: 30, min_quantity: 20, ideal_quantity: 60 }))).toBe(30)
    expect(sugestaoCompra(item({ quantity: 8, min_quantity: 20 }))).toBe(32)
    expect(sugestaoCompra(item({ quantity: 0, min_quantity: 0 }))).toBe(0)
    expect(sugestaoCompra(item({ quantity: 100, min_quantity: 20, ideal_quantity: 10 }))).toBe(0)
  })
})

describe('lista de compras', () => {
  const itens = [
    item({ name: 'Seringa', quantity: 5, min_quantity: 10, unit: 'un', supplier: 'Dental Sul' }),
    item({ name: 'Anestésico', quantity: 2, min_quantity: 5, unit: 'caixa', supplier: 'Dental Sul' }),
    item({ name: 'Gaze', quantity: 1, min_quantity: 4 }),
    item({ name: 'Algodão', quantity: 1, min_quantity: 4, unit: 'pct', supplier: 'Alfa' }),
    item({ name: 'Luvas', quantity: 50, min_quantity: 20, supplier: 'Alfa' }),
    item({ name: 'Inativo', quantity: 0, min_quantity: 5, active: false, supplier: 'Alfa' }),
  ]
  it('agrupa, ordena e exclui ok/inativos', () => {
    const g = listaDeCompras(itens)
    expect(g.map((x) => x.fornecedor)).toEqual(['Alfa', 'Dental Sul', 'Sem fornecedor'])
    expect(g[1].itens.map((i) => i.nome)).toEqual(['Anestésico', 'Seringa'])
    expect(g[1].itens[0]).toEqual({ id: 'Anestésico', nome: 'Anestésico', quantidade: 8, unidade: 'caixa' })
  })
  it('texto exato do WhatsApp', () => {
    const t = textoListaCompras(listaDeCompras(itens), 'Clínica Sorriso', '2026-11-10')
    expect(t).toBe(
      [
        'Lista de compras — Clínica Sorriso — 10/11/2026',
        '',
        '*Alfa*',
        '• Algodão — 7 pct',
        '',
        '*Dental Sul*',
        '• Anestésico — 8 caixa',
        '• Seringa — 15 un',
        '',
        '*Sem fornecedor*',
        '• Gaze — 7',
      ].join('\n'),
    )
  })
})
