// Divergência entre o item da guia (congelado) e o tratamento atual.

import type { GuideTooth } from '@/types'

type Divergencia = 'procedimento' | 'valor' | 'dentes'

function chaveDentes(teeth: GuideTooth[]): string {
  return JSON.stringify(
    [...teeth]
      .sort((a, b) => a.tooth - b.tooth)
      .map((t) => [t.tooth, [...t.faces].sort()]),
  )
}

export function divergencias(
  item: { code: string; value: number; teeth: GuideTooth[] },
  trat: { code: string | null; value: number; teeth: GuideTooth[] } | null,
): Divergencia[] {
  if (!trat) return []
  const r: Divergencia[] = []
  if (trat.code !== item.code) r.push('procedimento')
  if (Math.abs(trat.value - item.value) > 0.005) r.push('valor')
  if (chaveDentes(trat.teeth) !== chaveDentes(item.teeth)) r.push('dentes')
  return r
}
