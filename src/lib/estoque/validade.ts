// Regras de validade dos lotes. Datas são strings YYYY-MM-DD; "hoje" vem de todayYmd (America/Sao_Paulo).

import type { InventoryLot } from '@/types'

const MS_DIA = 86_400_000

function utc(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** Dias até a validade; negativo = vencido, 0 = vence hoje. */
export function diasParaVencer(expiresAt: string, hojeYmd: string): number {
  return Math.round((utc(expiresAt) - utc(hojeYmd)) / MS_DIA)
}

export type SituacaoLote = 'vencido' | 'vence_em_breve' | 'ok' | 'sem_validade'

export function situacaoLote(expiresAt: string | null, hojeYmd: string): SituacaoLote {
  if (!expiresAt) return 'sem_validade'
  const dias = diasParaVencer(expiresAt, hojeYmd)
  if (dias < 0) return 'vencido'
  return dias <= 30 ? 'vence_em_breve' : 'ok'
}

/** Menor validade entre os lotes com saldo; null se nenhum tiver validade. */
export function proximaValidade(lotes: Pick<InventoryLot, 'expires_at' | 'quantity'>[]): string | null {
  let menor: string | null = null
  for (const l of lotes) {
    if (l.quantity <= 0 || !l.expires_at) continue
    if (menor === null || l.expires_at < menor) menor = l.expires_at
  }
  return menor
}
