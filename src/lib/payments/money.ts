export function toCents(reais: number): number {
  return Math.round(reais * 100)
}

export function fromCents(c: number): number {
  return c / 100
}
