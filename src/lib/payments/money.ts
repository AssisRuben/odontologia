export function toCents(reais: number): number {
  return Math.round(reais * 100)
}

export function fromCents(c: number): number {
  return c / 100
}

/** Lê um valor digitado em reais (pt-BR ou com ponto decimal) e devolve centavos, ou null se inválido. */
export function parseReaisInput(s: string): number | null {
  const t = (s ?? '').trim().replace(/^R\$\s*/i, '').trim()
  if (!t) return null
  let intPart: string
  let frac = ''
  if (t.includes(',')) {
    const parts = t.split(',')
    if (parts.length !== 2 || !/^\d{1,2}$/.test(parts[1])) return null
    if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(parts[0])) return null
    intPart = parts[0].replace(/\./g, '')
    frac = parts[1]
  } else if (t.includes('.')) {
    const parts = t.split('.')
    if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1])) {
      intPart = parts[0]
      frac = parts[1]
    } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
      intPart = t.replace(/\./g, '')
    } else return null
  } else {
    if (!/^\d+$/.test(t)) return null
    intPart = t
  }
  return Number(intPart) * 100 + Number(frac.padEnd(2, '0'))
}
