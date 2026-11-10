import type { InventoryItem } from '@/types'
import { situacaoLote } from './validade'

export type AlertasItem = { baixo: boolean; vencidos: number; vencendo: number }

export function alertasDoItem(item: InventoryItem, hojeYmd: string): AlertasItem {
  let vencidos = 0
  let vencendo = 0
  for (const l of item.lots ?? []) {
    if (l.quantity <= 0) continue
    const s = situacaoLote(l.expires_at, hojeYmd)
    if (s === 'vencido') vencidos++
    else if (s === 'vence_em_breve') vencendo++
  }
  return { baixo: item.quantity <= item.min_quantity, vencidos, vencendo }
}

/** Contagem de itens ativos com estoque baixo e de lotes vencidos / vencendo. */
export function resumoAlertas(itens: InventoryItem[], hojeYmd: string): { baixo: number; vencidos: number; vencendo: number } {
  const r = { baixo: 0, vencidos: 0, vencendo: 0 }
  for (const i of itens) {
    if (!i.active) continue
    const a = alertasDoItem(i, hojeYmd)
    if (a.baixo) r.baixo++
    r.vencidos += a.vencidos
    r.vencendo += a.vencendo
  }
  return r
}
