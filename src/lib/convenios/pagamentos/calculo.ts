// Cálculos puros de pagamento de lote: tudo em centavos inteiros para evitar erro de ponto flutuante.

import { prazo } from '../periodo'

export const paraCentavos = (v: number): number => Math.round(v * 100)
export const deCentavos = (c: number): number => c / 100

export function glosaDe(value: number, paid: number): number {
  return deCentavos(Math.max(0, paraCentavos(value) - paraCentavos(paid)))
}

export function totaisLote(
  itens: { value: number; paid_value: number | null }[],
  deposit: number | null,
): { enviado: number; pago: number; glosado: number; diferenca: number | null } {
  let enviado = 0
  let pago = 0
  let glosado = 0
  for (const i of itens) {
    const v = paraCentavos(i.value)
    enviado += v
    if (i.paid_value === null) continue
    const p = paraCentavos(i.paid_value)
    pago += p
    glosado += Math.max(0, v - p)
  }
  return {
    enviado: deCentavos(enviado),
    pago: deCentavos(pago),
    glosado: deCentavos(glosado),
    diferenca: deposit === null ? null : deCentavos(paraCentavos(deposit) - pago),
  }
}

/** Total pago por paciente, sem os que somam zero. */
export function agruparPorPaciente(
  itens: { patient_id: string; paid_value: number }[],
): { patient_id: string; total: number }[] {
  const soma = new Map<string, number>()
  for (const i of itens) soma.set(i.patient_id, (soma.get(i.patient_id) ?? 0) + paraCentavos(i.paid_value))
  return [...soma.entries()]
    .filter(([, c]) => c !== 0)
    .map(([patient_id, c]) => ({ patient_id, total: deCentavos(c) }))
}

export function dataPrevista(sentAt: string, paymentDays: number): string {
  return prazo(sentAt, paymentDays)
}

export function prazoRecurso(paidAt: string, appealDays: number): string {
  return prazo(paidAt, appealDays)
}
