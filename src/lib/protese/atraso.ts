// Atraso de um trabalho de prótese em relação à previsão de retorno.

import type { ProstheticStatus } from '@/types'

/** Dias entre dois YYYY-MM-DD (b - a), sem depender de fuso. */
export function diffDias(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map(Number)
  const [yb, mb, db] = b.split('-').map(Number)
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000)
}

/** Só conta enquanto o trabalho não voltou ao consultório; no dia da previsão ainda não é atraso. */
export function diasDeAtraso(
  p: { status: ProstheticStatus; expected_at?: string | null },
  hojeYmd: string,
): number {
  if (p.status !== 'requested' && p.status !== 'sent_to_lab') return 0
  if (!p.expected_at) return 0
  return Math.max(0, diffDias(p.expected_at.slice(0, 10), hojeYmd))
}
