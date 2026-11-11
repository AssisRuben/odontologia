import { subMonths } from 'date-fns'

type ComNascimento = { birthdate?: string | null }
type Consulta = { patient_id: string; start_time: string; status: string }

/** Quem faz aniversário no mês de `hoje` ('YYYY-MM-DD'), em ordem de dia. */
export function aniversariantesDoMes<T extends ComNascimento>(pacientes: T[], hoje: string): T[] {
  const mes = hoje.slice(5, 7)
  return pacientes
    .filter((p) => p.birthdate?.slice(5, 7) === mes)
    .sort((a, b) => a.birthdate!.slice(8, 10).localeCompare(b.birthdate!.slice(8, 10)))
}

const FUTURA_VALE = new Set(['scheduled', 'confirmed', 'waiting', 'in_progress'])

/**
 * Pacientes cuja última consulta concluída foi há 6 meses ou mais
 * e que não têm consulta futura marcada. Mais antigos primeiro.
 */
export function retornosPendentes<T extends { id: string }>(
  pacientes: T[],
  consultas: Consulta[],
  agora: Date,
): { paciente: T; ultima: string }[] {
  const limite = subMonths(agora, 6).getTime()
  const ultima = new Map<string, string>()
  const temFutura = new Set<string>()
  for (const c of consultas) {
    const t = new Date(c.start_time).getTime()
    if (c.status === 'completed') {
      const atual = ultima.get(c.patient_id)
      if (!atual || t > new Date(atual).getTime()) ultima.set(c.patient_id, c.start_time)
    } else if (FUTURA_VALE.has(c.status) && t > agora.getTime()) {
      temFutura.add(c.patient_id)
    }
  }
  return pacientes
    .flatMap((paciente) => {
      const u = ultima.get(paciente.id)
      return u && new Date(u).getTime() <= limite && !temFutura.has(paciente.id) ? [{ paciente, ultima: u }] : []
    })
    .sort((a, b) => new Date(a.ultima).getTime() - new Date(b.ultima).getTime())
}
