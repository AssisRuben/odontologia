import { zonedParts, todayYmd } from '@/lib/messaging/time'
import type { Candidato } from './horarios'
import { MAX_OFFERS, MAX_PER_DAY } from './limites'

export type Preferencia = {
  dias_semana: number[] | null
  periodo: 'manha' | 'tarde' | 'noite' | null
  a_partir_de: string | null
  profissional: string | null
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

function periodoDe(hour: number): 'manha' | 'tarde' | 'noite' {
  return hour < 12 ? 'manha' : hour < 18 ? 'tarde' : 'noite'
}

export function escolherOfertas(
  candidatos: Candidato[],
  pref: Preferencia | null,
  timezone: string,
): { escolhidos: Candidato[]; relaxou: boolean } {
  let base = candidatos
  if (pref?.profissional && norm(pref.profissional)) {
    const q = norm(pref.profissional)
    base = base.filter((c) => norm(c.professional_name).includes(q))
    if (base.length === 0) return { escolhidos: [], relaxou: false }
  }

  const info = (c: Candidato) => {
    const d = new Date(c.start)
    return { weekday: zonedParts(d, timezone).weekday, hour: zonedParts(d, timezone).hour, ymd: todayYmd(d, timezone) }
  }
  const aplicar = (usar: { periodo: boolean; dias: boolean; desde: boolean }) =>
    base.filter((c) => {
      const i = info(c)
      if (usar.periodo && pref?.periodo && periodoDe(i.hour) !== pref.periodo) return false
      if (usar.dias && pref?.dias_semana && !pref.dias_semana.includes(i.weekday)) return false
      if (usar.desde && pref?.a_partir_de && i.ymd < pref.a_partir_de) return false
      return true
    })

  const tentativas = [
    { periodo: true, dias: true, desde: true },
    { periodo: false, dias: true, desde: true },
    { periodo: false, dias: false, desde: true },
    { periodo: false, dias: false, desde: false },
  ]
  let lista: Candidato[] = []
  let relaxou = false
  for (let k = 0; k < tentativas.length; k++) {
    lista = aplicar(tentativas[k])
    if (lista.length > 0) {
      relaxou = k > 0
      break
    }
  }

  const porDia = new Map<string, number>()
  const escolhidos: Candidato[] = []
  for (const c of lista) {
    if (escolhidos.length >= MAX_OFFERS) break
    const dia = todayYmd(new Date(c.start), timezone)
    const n = porDia.get(dia) ?? 0
    if (n >= MAX_PER_DAY) continue
    porDia.set(dia, n + 1)
    escolhidos.push(c)
  }
  return { escolhidos, relaxou }
}
