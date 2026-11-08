// Períodos de faturamento por operadora. Datas são 'YYYY-MM-DD'; aritmética em UTC sobre a string.

const DIA_MS = 86_400_000

function paraUtc(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function deUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function somarDias(ymd: string, dias: number): string {
  return deUtc(paraUtc(ymd) + dias * DIA_MS)
}

/** Data com o dia `dia` (1–28) no mês `mes0` (0-based) do ano `ano`, normalizando virada de ano. */
function dataNoMes(ano: number, mes0: number, dia: number): string {
  return deUtc(Date.UTC(ano, mes0, dia))
}

/** `ate − de` em dias. */
export function diasEntre(de: string, ate: string): number {
  return Math.round((paraUtc(ate) - paraUtc(de)) / DIA_MS)
}

/** Fim = primeiro dia `closingDay` >= data; início = dia seguinte ao fechamento anterior. */
export function periodoDe(data: string, closingDay: number): { start: string; end: string } {
  const [y, m, d] = data.split('-').map(Number)
  const mesFim = d <= closingDay ? m - 1 : m
  const end = dataNoMes(y, mesFim, closingDay)
  const start = somarDias(dataNoMes(y, mesFim - 1, closingDay), 1)
  return { start, end }
}

/** Período imediatamente seguinte ao que termina em `end`. */
export function proximoPeriodo(end: string, closingDay: number): { start: string; end: string } {
  return periodoDe(somarDias(end, 1), closingDay)
}

/** Data limite de envio: fim do período + `submissionDays`. */
export function prazo(end: string, submissionDays: number): string {
  return somarDias(end, submissionDays)
}
