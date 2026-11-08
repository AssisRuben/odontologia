import type { Appointment } from '@/types'
import { todayYmd } from '@/lib/messaging/time'

/**
 * Pacientes na sala de espera: consultas de hoje (no fuso da clínica) com status
 * "Aguardando", do profissional selecionado (se houver), em ordem de horário.
 */
export function aguardandoHoje<T extends Pick<Appointment, 'start_time' | 'status' | 'professional_id'>>(
  apts: T[],
  hoje: string,
  tz: string,
  professionalId?: string | null,
): T[] {
  return apts
    .filter((a) =>
      a.status === 'waiting' &&
      (!professionalId || a.professional_id === professionalId) &&
      todayYmd(new Date(a.start_time), tz) === hoje)
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
}
