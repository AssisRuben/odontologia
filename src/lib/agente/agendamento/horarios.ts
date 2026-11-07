import type { AgentConfig, DayKey } from '../config'
import { zonedDateTime, todayYmd } from '@/lib/messaging/time'
import type { RegrasAgendamento, WorkingHours } from './config'

export type ProfissionalAgenda = { id: string; nome: string; workingHours: WorkingHours }
export type Ocupado = { professional_id: string; start: string; end: string }
export type Candidato = { professional_id: string; professional_name: string; start: string; end: string }

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
function toHhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

/** Dia seguinte em calendário (aritmética em UTC sobre a data civil). */
function addDays(ymd: string, n: number): { ymd: string; weekday: number } {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return { ymd: dt.toISOString().slice(0, 10), weekday: dt.getUTCDay() }
}

export function calcularHorarios(args: {
  profissionais: ProfissionalAgenda[]
  ocupados: Ocupado[]
  clinicHours: AgentConfig['hours']
  regras: RegrasAgendamento
  duracaoMin: number
  now: Date
  timezone: string
}): Candidato[] {
  const { profissionais, ocupados, clinicHours, regras, duracaoMin, now, timezone } = args
  const minStart = now.getTime() + regras.antecedencia_h * 3_600_000
  const durMs = duracaoMin * 60_000
  const busy = new Map<string, { s: number; e: number }[]>()
  for (const o of ocupados) {
    const list = busy.get(o.professional_id) ?? []
    list.push({ s: new Date(o.start).getTime(), e: new Date(o.end).getTime() })
    busy.set(o.professional_id, list)
  }
  const hoje = todayYmd(now, timezone)
  const out: Candidato[] = []

  for (let i = 0; i <= regras.dias_a_frente; i++) {
    const { ymd, weekday } = addDays(hoje, i)
    const clinica = clinicHours[String(weekday) as DayKey]
    if (!clinica) continue
    const cIni = toMin(clinica[0])
    const cFim = toMin(clinica[1])
    for (const p of profissionais) {
      const periodos = p.workingHours[String(weekday) as DayKey]
      if (!periodos) continue
      const mine = busy.get(p.id) ?? []
      for (const [a, b] of periodos) {
        const ini = Math.max(toMin(a), cIni)
        const fim = Math.min(toMin(b), cFim)
        for (let t = Math.ceil(ini / regras.intervalo_min) * regras.intervalo_min; t + duracaoMin <= fim; t += regras.intervalo_min) {
          const start = zonedDateTime(ymd, toHhmm(t), timezone).getTime()
          if (start < minStart) continue
          const end = start + durMs
          if (mine.some((o) => o.s < end && o.e > start)) continue
          out.push({
            professional_id: p.id,
            professional_name: p.nome,
            start: new Date(start).toISOString(),
            end: new Date(end).toISOString(),
          })
        }
      }
    }
  }
  return out.sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : x.professional_name.localeCompare(y.professional_name, 'pt-BR')))
}

