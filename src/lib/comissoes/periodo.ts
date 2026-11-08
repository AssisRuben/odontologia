/** Mês = `YYYY-MM`; datas = `YYYY-MM-DD`. */

export function mesValido(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)
}

export function mesDe(data: string): string {
  return data.slice(0, 7)
}

export function primeiroDia(mes: string): string {
  return `${mes}-01`
}

export function ultimoDia(mes: string): string {
  const [y, m] = mes.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${mes}-${String(d).padStart(2, '0')}`
}

export function mesAnterior(mes: string): string {
  const [y, m] = mes.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 2, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** `hoje` é YYYY-MM-DD (America/Sao_Paulo). */
export function mesEncerrado(mes: string, hoje: string): boolean {
  return ultimoDia(mes) < hoje
}

export function rotuloMes(mes: string): string {
  return `${mes.slice(5, 7)}/${mes.slice(0, 4)}`
}
