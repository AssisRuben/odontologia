import { describe, it, expect } from 'vitest'
import { linhasDoKit, faltas, podeBaixar } from '@/lib/kits/baixa'
import type { Kit } from '@/types'

const kit = {
  id: 'k', clinic_id: 'c', name: 'Kit', active: true, created_at: '', updated_at: '',
  items: [
    { id: '1', item_id: 'a', quantity: 2 },
    { id: '2', item_id: 'b', quantity: 1 },
  ],
} as Kit

describe('baixa', () => {
  it('linhasDoKit converte os itens', () => {
    expect(linhasDoKit(kit)).toEqual([{ itemId: 'a', quantity: 2 }, { itemId: 'b', quantity: 1 }])
    expect(linhasDoKit({ ...kit, items: undefined })).toEqual([])
  })
  it('faltas marca item acima do saldo', () => {
    const f = faltas([{ itemId: 'a', quantity: 3 }, { itemId: 'b', quantity: 1 }], new Map([['a', 2], ['b', 5]]))
    expect([...f]).toEqual(['a'])
  })
  it('podeBaixar', () => {
    const s = new Map([['a', 5], ['b', 5]])
    expect(podeBaixar([], s)).toBe(false)
    expect(podeBaixar([{ itemId: 'a', quantity: 0 }], s)).toBe(false)
    expect(podeBaixar([{ itemId: 'a', quantity: 10000 }], new Map([['a', 99999]]))).toBe(false)
    expect(podeBaixar([{ itemId: 'a', quantity: 1 }, { itemId: 'a', quantity: 1 }], s)).toBe(false)
    expect(podeBaixar([{ itemId: 'a', quantity: 6 }], s)).toBe(false)
    expect(podeBaixar([{ itemId: 'a', quantity: 2 }, { itemId: 'b', quantity: 1 }], s)).toBe(true)
  })
})
