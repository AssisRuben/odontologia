import type { Kit } from '@/types'

export type Linha = { itemId: string; quantity: number }

export function linhasDoKit(kit: Kit): Linha[] {
  return (kit.items ?? []).map((ki) => ({ itemId: ki.item_id, quantity: ki.quantity }))
}

/** itemIds cuja quantidade passa do saldo atual. */
export function faltas(linhas: Linha[], saldos: Map<string, number>): Set<string> {
  const r = new Set<string>()
  for (const l of linhas) if (l.quantity > (saldos.get(l.itemId) ?? 0)) r.add(l.itemId)
  return r
}

export function podeBaixar(linhas: Linha[], saldos: Map<string, number>): boolean {
  if (linhas.length === 0) return false
  if (linhas.some((l) => !Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 9999)) return false
  if (new Set(linhas.map((l) => l.itemId)).size !== linhas.length) return false
  return faltas(linhas, saldos).size === 0
}
