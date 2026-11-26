// Valores iniciais da janela de evolução: pela agenda vêm da consulta; pelo prontuário, sem consulta.
import { format, parseISO } from 'date-fns'

/**
 * Dentista que já vem escolhido: quem está usando o sistema, se for dentista; senão, quem atendeu o
 * paciente por último (ids das consultas, da mais recente para a mais antiga); senão, o primeiro da clínica.
 */
export function profissionalPadrao(
  profissionais: { id: string; user_id?: string | null }[],
  userId: string | null,
  atendeuPorUltimo: string[],
): string {
  const ids = new Set(profissionais.map((p) => p.id))
  const doUsuario = userId ? profissionais.find((p) => p.user_id === userId) : undefined
  return doUsuario?.id ?? atendeuPorUltimo.find((id) => ids.has(id)) ?? profissionais[0]?.id ?? ''
}

export function inicioEvolucao(o: {
  appointment: { id: string; patient_id: string; professional_id: string; start_time: string; patient?: { name: string } | null } | null
  paciente?: { id: string; name: string }
  profissionalInicial?: string
  hoje: Date
}) {
  const a = o.appointment
  return {
    patientId: a?.patient_id ?? o.paciente?.id ?? '',
    patientName: a?.patient?.name ?? o.paciente?.name ?? 'Paciente',
    professionalId: a?.professional_id ?? o.profissionalInicial ?? '',
    date: format(a ? parseISO(a.start_time) : o.hoje, 'yyyy-MM-dd'),
    appointmentId: a?.id ?? null,
  }
}
