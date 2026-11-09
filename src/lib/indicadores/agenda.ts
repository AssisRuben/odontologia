import type { AppointmentStatus } from '@/types'
import { todayYmd } from '@/lib/messaging/time'
import { mesDoInstante } from './periodo'

export type ConsultaIn = {
  id: string
  patient_id: string
  professional_id: string
  start_time: string
  status: AppointmentStatus
}

export type Contagem = {
  total: number
  atendidas: number
  faltas: number
  canceladas: number
  semDesfecho: number
  comparecimento: number | null
  taxaFaltas: number | null
  taxaCancelamento: number | null
}

function contar(cs: ConsultaIn[]): Contagem {
  let atendidas = 0
  let faltas = 0
  let canceladas = 0
  let semDesfecho = 0
  for (const c of cs) {
    if (c.status === 'completed' || c.status === 'in_progress') atendidas++
    else if (c.status === 'no_show') faltas++
    else if (c.status === 'cancelled') canceladas++
    else semDesfecho++
  }
  const total = cs.length
  const base = atendidas + faltas
  return {
    total,
    atendidas,
    faltas,
    canceladas,
    semDesfecho,
    comparecimento: base > 0 ? atendidas / base : null,
    taxaFaltas: base > 0 ? faltas / base : null,
    taxaCancelamento: total > 0 ? canceladas / total : null,
  }
}

function passadas(cs: ConsultaIn[], agora: Date, professionalId: string | null): ConsultaIn[] {
  const limite = agora.getTime()
  return cs.filter(
    (c) =>
      new Date(c.start_time).getTime() < limite &&
      (professionalId === null || c.professional_id === professionalId),
  )
}

export function resumoAgenda(
  consultas: ConsultaIn[],
  mes: string,
  agora: Date,
  professionalId: string | null,
): Contagem & { porDentista: ({ professional_id: string } & Contagem)[] } {
  const doMes = passadas(consultas, agora, professionalId).filter((c) => mesDoInstante(c.start_time) === mes)
  const grupos = new Map<string, ConsultaIn[]>()
  for (const c of doMes) {
    const g = grupos.get(c.professional_id)
    if (g) g.push(c)
    else grupos.set(c.professional_id, [c])
  }
  const porDentista = [...grupos.keys()]
    .sort()
    .map((id) => ({ professional_id: id, ...contar(grupos.get(id)!) }))
  return { ...contar(doMes), porDentista }
}

export function maisFaltam(
  consultas: ConsultaIn[],
  meses: string[],
  agora: Date,
  professionalId: string | null,
): { patient_id: string; faltas: number; ultima: string }[] {
  const janela = new Set(meses)
  const acc = new Map<string, { faltas: number; ultima: string }>()
  for (const c of passadas(consultas, agora, professionalId)) {
    if (c.status !== 'no_show' || !janela.has(mesDoInstante(c.start_time))) continue
    const dia = todayYmd(new Date(c.start_time), 'America/Sao_Paulo')
    const a = acc.get(c.patient_id)
    if (a) {
      a.faltas++
      if (dia > a.ultima) a.ultima = dia
    } else acc.set(c.patient_id, { faltas: 1, ultima: dia })
  }
  return [...acc.entries()]
    .filter(([, a]) => a.faltas >= 2)
    .map(([patient_id, a]) => ({ patient_id, ...a }))
    .sort((x, y) => y.faltas - x.faltas || (x.ultima < y.ultima ? 1 : x.ultima > y.ultima ? -1 : 0))
    .slice(0, 10)
}
