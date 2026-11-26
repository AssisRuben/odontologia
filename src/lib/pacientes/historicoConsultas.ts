// Histórico de consultas do prontuário: resumo, próximas, passadas por ano e a evolução de cada consulta.
import { format, parseISO } from 'date-fns'
import type { AppointmentStatus } from '@/types'

export interface ConsultaHist {
  id: string
  start_time: string
  end_time: string
  status: AppointmentStatus
  procedure?: string | null
  professional?: { name: string; color?: string | null } | null
}

export interface EvolucaoHist {
  id: string
  /** yyyy-MM-dd */
  date: string
  appointment_id: string | null
}

export interface ResumoConsultas {
  /** Consultas concluídas. */
  realizadas: number
  /** Início da primeira consulta concluída. */
  primeira: string | null
  faltas: number
  canceladas: number
  /** Quem atendeu as consultas concluídas, do que mais atendeu ao que menos. */
  dentistas: string[]
}

const FORA_DAS_PROXIMAS: AppointmentStatus[] = ['cancelled', 'no_show']

const inicio = (x: ConsultaHist) => parseISO(x.start_time).getTime()
const diaLocal = (x: ConsultaHist) => format(parseISO(x.start_time), 'yyyy-MM-dd')

function resumir(consultas: ConsultaHist[]): ResumoConsultas {
  const concluidas = consultas.filter((x) => x.status === 'completed').sort((a, b) => inicio(a) - inicio(b))
  const porDentista = new Map<string, number>()
  for (const x of concluidas) {
    const nome = x.professional?.name
    if (nome) porDentista.set(nome, (porDentista.get(nome) ?? 0) + 1)
  }
  return {
    realizadas: concluidas.length,
    primeira: concluidas[0]?.start_time ?? null,
    faltas: consultas.filter((x) => x.status === 'no_show').length,
    canceladas: consultas.filter((x) => x.status === 'cancelled').length,
    dentistas: [...porDentista.entries()].sort((a, b) => b[1] - a[1]).map(([nome]) => nome),
  }
}

/**
 * Liga cada evolução a uma consulta: primeiro pela consulta gravada na evolução; as que não têm (ou apontam
 * para consulta fora da lista) vão para a primeira consulta do mesmo dia que ainda não tenha evolução.
 */
function ligarEvolucoes<C extends ConsultaHist, E extends EvolucaoHist>(consultas: C[], evolucoes: E[]) {
  const evolucoesDa: Record<string, E[]> = {}
  const existe = new Set(consultas.map((x) => x.id))
  const soltas: E[] = []
  for (const ev of evolucoes) {
    if (ev.appointment_id && existe.has(ev.appointment_id)) (evolucoesDa[ev.appointment_id] ??= []).push(ev)
    else soltas.push(ev)
  }
  const doDia = new Map<string, C[]>()
  for (const x of [...consultas].sort((a, b) => inicio(a) - inicio(b))) {
    const dia = diaLocal(x)
    doDia.set(dia, [...(doDia.get(dia) ?? []), x])
  }
  for (const ev of soltas) {
    const candidatas = doDia.get(ev.date)
    if (!candidatas) continue
    const alvo = candidatas.find((x) => !evolucoesDa[x.id]) ?? candidatas[0]
    ;(evolucoesDa[alvo.id] ??= []).push(ev)
  }
  return evolucoesDa
}

export function montarHistorico<C extends ConsultaHist, E extends EvolucaoHist>(consultas: C[], evolucoes: E[], agora: Date) {
  const limite = agora.getTime()
  const proximas = consultas
    .filter((x) => inicio(x) >= limite && !FORA_DAS_PROXIMAS.includes(x.status))
    .sort((a, b) => inicio(a) - inicio(b))
  const naLista = new Set(proximas.map((x) => x.id))
  const passadas = consultas.filter((x) => !naLista.has(x.id)).sort((a, b) => inicio(b) - inicio(a))

  const anos: { ano: number; consultas: C[] }[] = []
  for (const x of passadas) {
    const ano = parseISO(x.start_time).getFullYear()
    const ultimo = anos.at(-1)
    if (ultimo?.ano === ano) ultimo.consultas.push(x)
    else anos.push({ ano, consultas: [x] })
  }

  return { resumo: resumir(consultas), proximas, anos, evolucoesDa: ligarEvolucoes(consultas, evolucoes) }
}
