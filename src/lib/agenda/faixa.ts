import { differenceInCalendarDays, parseISO } from 'date-fns'

/** Faixa padrão da grade da agenda, em minutos do dia. */
const INICIO_PADRAO = 7 * 60
const FIM_PADRAO = 21 * 60
const PASSO = 30

function hhmmss(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00`
}

/**
 * Horário de início e fim da grade (formato do FullCalendar): 7h às 21h, esticando em
 * meia hora o necessário para mostrar consultas fora disso. Consulta que passa da
 * meia-noite vai até o fim do dia.
 */
export function faixaAgenda(consultas: { start_time: string; end_time: string }[]): { inicio: string; fim: string } {
  let inicio = INICIO_PADRAO
  let fim = FIM_PADRAO
  for (const c of consultas) {
    const a = parseISO(c.start_time)
    const b = parseISO(c.end_time)
    if (isNaN(a.getTime()) || isNaN(b.getTime())) continue
    const minA = a.getHours() * 60 + a.getMinutes()
    const minB = differenceInCalendarDays(b, a) > 0 ? 24 * 60 : b.getHours() * 60 + b.getMinutes()
    inicio = Math.min(inicio, Math.floor(minA / PASSO) * PASSO)
    fim = Math.max(fim, Math.min(24 * 60, Math.ceil(minB / PASSO) * PASSO))
  }
  return { inicio: hhmmss(inicio), fim: hhmmss(fim) }
}
