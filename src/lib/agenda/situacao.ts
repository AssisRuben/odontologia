// Situação da consulta na tela: "Cancelado" se divide em "pelo paciente" e "pelo dentista".
// No banco a situação continua 'cancelled'; quem cancelou fica em cancelled_by.
import { APPOINTMENT_STATUS_LABELS, type AppointmentStatus, type CanceladoPor } from '@/types'

/** Valor da lista de situação: a situação, ou o cancelamento com quem cancelou. 'cancelled' sozinho = antigo. */
export type ValorSituacao = AppointmentStatus | 'cancelled:patient' | 'cancelled:professional'

const ROTULO_CANCELADO: Record<CanceladoPor, string> = {
  patient: 'Cancelado pelo paciente',
  professional: 'Cancelado pelo dentista',
}

export function valorDaSituacao(status: AppointmentStatus, cancelledBy?: CanceladoPor | null): ValorSituacao {
  return status === 'cancelled' && cancelledBy ? `cancelled:${cancelledBy}` : status
}

export function lerSituacao(v: ValorSituacao): { status: AppointmentStatus; cancelled_by: CanceladoPor | null } {
  if (v === 'cancelled:patient') return { status: 'cancelled', cancelled_by: 'patient' }
  if (v === 'cancelled:professional') return { status: 'cancelled', cancelled_by: 'professional' }
  return { status: v, cancelled_by: null }
}

export function rotuloSituacao(status: AppointmentStatus, cancelledBy?: CanceladoPor | null): string {
  if (status === 'cancelled' && cancelledBy) return ROTULO_CANCELADO[cancelledBy]
  return APPOINTMENT_STATUS_LABELS[status] ?? status
}

/** Opções da lista. "Cancelado" sem quem cancelou só aparece se for a situação atual (consulta antiga). */
export function opcoesSituacao(atual: ValorSituacao): { value: ValorSituacao; label: string }[] {
  const opcoes: { value: ValorSituacao; label: string }[] = []
  for (const s of Object.keys(APPOINTMENT_STATUS_LABELS) as AppointmentStatus[]) {
    if (s !== 'cancelled') {
      opcoes.push({ value: s, label: APPOINTMENT_STATUS_LABELS[s] })
      continue
    }
    if (atual === 'cancelled') opcoes.push({ value: 'cancelled', label: APPOINTMENT_STATUS_LABELS.cancelled })
    opcoes.push({ value: 'cancelled:patient', label: ROTULO_CANCELADO.patient })
    opcoes.push({ value: 'cancelled:professional', label: ROTULO_CANCELADO.professional })
  }
  return opcoes
}

/** A consulta com a situação escolhida (ex.: a que o popup passa para "Editar", depois de mudar a situação ali). */
export function aplicarSituacao<A extends { status: AppointmentStatus; cancelled_by?: CanceladoPor | null }>(apt: A, v: ValorSituacao): A {
  return { ...apt, ...lerSituacao(v) }
}
