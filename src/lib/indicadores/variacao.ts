export type Variacao = { tipo: 'pp' | 'pct' | 'novo' | 'vazio'; valor: number | null }

const VAZIO: Variacao = { tipo: 'vazio', valor: null }
const NOVO: Variacao = { tipo: 'novo', valor: null }

/** Taxas em fração 0–1; variação em pontos percentuais, 1 casa. */
export function variacaoTaxa(atual: number | null, anterior: number | null): Variacao {
  if (atual === null) return VAZIO
  if (anterior === null) return NOVO
  return { tipo: 'pp', valor: Math.round((atual - anterior) * 1000) / 10 }
}

export function variacaoValor(atual: number, anterior: number): Variacao {
  if (anterior === 0) return atual > 0 ? NOVO : VAZIO
  return { tipo: 'pct', valor: Math.round(((atual - anterior) / anterior) * 100) }
}

export function rotuloVariacao(v: Variacao): string {
  if (v.tipo === 'novo') return 'novo'
  if (v.tipo === 'vazio' || v.valor === null) return '—'
  const sufixo = v.tipo === 'pp' ? ' p.p.' : '%'
  const abs = Math.abs(v.valor)
  const texto = String(abs).replace('.', ',')
  if (abs === 0) return `0${sufixo}`
  return `${v.valor > 0 ? '▲' : '▼'} ${texto}${sufixo}`
}
