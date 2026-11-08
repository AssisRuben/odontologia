// Destino dos itens nos lotes por período. Datas são 'YYYY-MM-DD'.

import type { BatchStatus } from '@/types'
import { periodoDe, proximoPeriodo, prazo } from './periodo'

type Periodo = { start: string; end: string }

/** Período do lote em que o item entra; períodos já enviados são pulados. */
export function destinoDoItem(
  execucao: string,
  deferUntil: string | null,
  closingDay: number,
  lotes: { period_end: string; status: BatchStatus }[],
): Periodo {
  const base = deferUntil && deferUntil > execucao ? deferUntil : execucao
  const enviados = new Set(lotes.filter((l) => l.status === 'enviado').map((l) => l.period_end))
  let periodo = periodoDe(base, closingDay)
  while (enviados.has(periodo.end)) periodo = proximoPeriodo(periodo.end, closingDay)
  return periodo
}

export function planejarLotes(args: {
  closingDay: number
  submissionDays: number
  itens: { id: string; execucao: string; defer_until: string | null }[]
  lotes: { id: string; period_end: string; status: BatchStatus }[]
}): {
  criar: { period_start: string; period_end: string; due_date: string }[]
  atribuir: { itemId: string; period_end: string }[]
} {
  const { closingDay, submissionDays, itens, lotes } = args
  const existentes = new Set(lotes.map((l) => l.period_end))
  const criar: { period_start: string; period_end: string; due_date: string }[] = []
  const atribuir: { itemId: string; period_end: string }[] = []

  for (const item of itens) {
    const destino = destinoDoItem(item.execucao, item.defer_until, closingDay, lotes)
    atribuir.push({ itemId: item.id, period_end: destino.end })
    if (!existentes.has(destino.end)) {
      existentes.add(destino.end)
      criar.push({
        period_start: destino.start,
        period_end: destino.end,
        due_date: prazo(destino.end, submissionDays),
      })
    }
  }
  return { criar, atribuir }
}

/** Execução anterior ao início do período do lote. */
export function atrasado(execucao: string, periodStart: string): boolean {
  return execucao < periodStart
}

/** Data para adiar um item: início do período seguinte ao que termina em `periodEnd`. */
export function adiarAte(periodEnd: string, closingDay: number): string {
  return proximoPeriodo(periodEnd, closingDay).start
}
