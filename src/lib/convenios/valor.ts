// Entrada de valores em reais digitados pelo usuário.

/** "1.234,56" ou "1234.56" -> número; texto inválido -> NaN. */
export function parseValor(s: string): number {
  const t = s.replace(/R\$/g, '').replace(/\s/g, '')
  if (t === '') return NaN
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  return /^\d+(\.\d+)?$/.test(normal) ? Number(normal) : NaN
}

export function valorParaTexto(v: number): string {
  return v.toFixed(2).replace('.', ',')
}
