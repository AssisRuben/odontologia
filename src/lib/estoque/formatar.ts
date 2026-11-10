// Textos de lote/data usados nas janelas de estoque.

/** 'YYYY-MM-DD' -> 'MM/yyyy'. */
export function mesAno(ymd: string): string {
  const [y, m] = ymd.split('-')
  return `${m}/${y}`
}

/** 'YYYY-MM-DD' -> 'dd/MM/yyyy'. */
export function dataBr(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  return `${d}/${m}/${y}`
}

/** 'Lote A23 (vence 03/2027)'; sem código -> 'Sem lote'. */
export function rotuloLote(lot: { lot_code: string | null; expires_at: string | null }): string {
  return `${lot.lot_code ? `Lote ${lot.lot_code}` : 'Sem lote'}${lot.expires_at ? ` (vence ${mesAno(lot.expires_at)})` : ''}`
}

/** Mesma data um ano antes (29/02 vira 01/03), em aritmética UTC. */
export function umAnoAntes(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y - 1, m - 1, d)).toISOString().slice(0, 10)
}

/** Mesma data 30 dias antes, em aritmética UTC. */
export function trintaDiasAntes(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - 30)).toISOString().slice(0, 10)
}
