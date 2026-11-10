// FEFO: primeiro a vencer, primeiro a sair. expires_at ASC NULLS LAST, created_at ASC.

import type { InventoryLot } from '@/types'

export function ordemFefo<T extends Pick<InventoryLot, 'expires_at' | 'created_at'>>(lotes: T[]): T[] {
  return [...lotes].sort((a, b) => {
    if (a.expires_at !== b.expires_at) {
      if (a.expires_at === null) return 1
      if (b.expires_at === null) return -1
      return a.expires_at < b.expires_at ? -1 : 1
    }
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
  })
}

/** Distribui a saída pelos lotes em ordem FEFO; null se o saldo não cobre a quantidade.
 *  Com pularVencidos, lotes com expires_at < hojeYmd ficam de fora (uso automático). */
export function planoSaida(
  lotes: InventoryLot[],
  quantidade: number,
  opts?: { hojeYmd?: string; pularVencidos?: boolean },
): { lotId: string; quantidade: number }[] | null {
  if (!Number.isInteger(quantidade) || quantidade <= 0) return null
  const plano: { lotId: string; quantidade: number }[] = []
  let falta = quantidade
  for (const l of ordemFefo(lotes.filter((x) => x.quantity > 0 && !(opts?.pularVencidos && opts.hojeYmd && x.expires_at && x.expires_at < opts.hojeYmd)))) {
    if (falta === 0) break
    const q = Math.min(l.quantity, falta)
    plano.push({ lotId: l.id, quantidade: q })
    falta -= q
  }
  return falta === 0 ? plano : null
}
