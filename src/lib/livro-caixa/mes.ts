const MONTH_NAMES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

const pad = (n: number, len = 2) => String(n).padStart(len, '0')

export function parseMonth(s: string): { year: number; month: number } | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) return null
  return { year: Number(s.slice(0, 4)), month: Number(s.slice(5, 7)) }
}

export function monthRange(ym: string): { first: string; last: string } {
  const p = parseMonth(ym)
  if (!p) throw new Error(`Mês inválido: ${ym}`)
  const days = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate()
  return { first: `${ym}-01`, last: `${ym}-${pad(days)}` }
}

export function shiftMonth(ym: string, delta: number): string {
  const p = parseMonth(ym)
  if (!p) throw new Error(`Mês inválido: ${ym}`)
  const idx = p.year * 12 + (p.month - 1) + delta
  return `${pad(Math.floor(idx / 12), 4)}-${pad((idx % 12) + 1)}`
}

export function monthLabel(ym: string): string {
  const p = parseMonth(ym)
  if (!p) throw new Error(`Mês inválido: ${ym}`)
  return `${MONTH_NAMES[p.month - 1]} de ${p.year}`
}

export function inMonth(ymd: string | null, ym: string): boolean {
  return ymd != null && ymd.slice(0, 7) === ym
}
