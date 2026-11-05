import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export function zonedParts(d: Date, tz: string) {
  const z = new TZDate(d.getTime(), tz)
  return {
    year: z.getFullYear(),
    month: z.getMonth() + 1,
    day: z.getDate(),
    hour: z.getHours(),
    minute: z.getMinutes(),
    weekday: z.getDay(),
  }
}

/** Instante UTC correspondente a "ymd hh:mm" no fuso informado. */
export function zonedDateTime(ymd: string, hhmm: string, tz: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  const [h, min] = hhmm.split(':').map(Number)
  return new Date(new TZDate(y, m - 1, d, h, min, 0, 0, tz).getTime())
}

export function todayYmd(now: Date, tz: string): string {
  return format(new TZDate(now.getTime(), tz), 'yyyy-MM-dd')
}

export function formatDataCurta(d: Date, tz: string): string {
  const z = new TZDate(d.getTime(), tz)
  const wd = format(z, "EEEE", { locale: ptBR }).replace(/-feira$/, "")
  return `${wd}, ${format(z, "dd/MM")}`
}

export function formatHora(d: Date, tz: string): string {
  return format(new TZDate(d.getTime(), tz), 'HH:mm')
}

export function formatDataLonga(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export function formatValor(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(n)
    .replace(/ /g, ' ')
}
