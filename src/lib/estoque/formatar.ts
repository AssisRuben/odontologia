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

/** 'Lote A23 (vence 03/2027)'; sem código -> 'Lote sem lote'. */
export function rotuloLote(lot: { lot_code: string | null; expires_at: string | null }): string {
  return `Lote ${lot.lot_code ?? 'sem lote'}${lot.expires_at ? ` (vence ${mesAno(lot.expires_at)})` : ''}`
}
