const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

/** 'YYYY-MM-DD' -> 'YYYY-MM' */
export function mesDe(ymd: string): string {
  return ymd.slice(0, 7)
}

/** 'YYYY-MM-DD' -> dia do mês */
export function diaDe(ymd: string): number {
  return Number(ymd.slice(8, 10))
}

/** 'YYYY-MM' -> 'novembro/2026' */
export function rotuloMes(mes: string): string {
  return `${MESES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(0, 4)}`
}
