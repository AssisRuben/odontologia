import type { DayKey } from '../config'

export type TipoConsulta = {
  id: string
  nome: string
  duracao_min: number
  profissionais: string[] | null
  ativo: boolean
}
export type RegrasAgendamento = {
  antecedencia_h: number
  dias_a_frente: number
  intervalo_min: 15 | 30 | 60
}
export type WorkingHours = Partial<Record<DayKey, [string, string][]>>

export const MAX_TIPOS = 20
export const TIPOS_PADRAO: TipoConsulta[] = [
  { id: 'avaliacao', nome: 'Avaliação', duracao_min: 30, profissionais: null, ativo: true },
  { id: 'retorno', nome: 'Retorno', duracao_min: 30, profissionais: null, ativo: true },
]
export const REGRAS_PADRAO: RegrasAgendamento = { antecedencia_h: 24, dias_a_frente: 30, intervalo_min: 30 }

const DAYS: DayKey[] = ['0', '1', '2', '3', '4', '5', '6']
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function asObj(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}
function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v)
}

// ── tipos ──

function parseTipo(raw: unknown): TipoConsulta | null {
  const o = asObj(raw)
  const id = typeof o.id === 'string' ? o.id.trim() : ''
  const nome = typeof o.nome === 'string' ? o.nome.trim() : ''
  if (!id || id.length > 40 || nome.length < 1 || nome.length > 60) return null
  if (!isInt(o.duracao_min) || o.duracao_min < 15 || o.duracao_min > 240 || o.duracao_min % 15 !== 0) return null
  if (typeof o.ativo !== 'boolean') return null
  let profissionais: string[] | null = null
  if (o.profissionais !== null && o.profissionais !== undefined) {
    if (!Array.isArray(o.profissionais) || !o.profissionais.every((p) => typeof p === 'string' && UUID.test(p))) return null
    profissionais = [...new Set(o.profissionais as string[])]
  }
  return { id, nome, duracao_min: o.duracao_min, profissionais, ativo: o.ativo }
}

export function normalizeTipos(raw: unknown): TipoConsulta[] {
  if (!Array.isArray(raw)) return TIPOS_PADRAO.map((t) => ({ ...t }))
  const seen = new Set<string>()
  const out: TipoConsulta[] = []
  for (const r of raw) {
    const t = parseTipo(r)
    if (!t || seen.has(t.id)) continue
    seen.add(t.id)
    out.push(t)
    if (out.length === MAX_TIPOS) break
  }
  return out.length ? out : TIPOS_PADRAO.map((t) => ({ ...t }))
}

export function validateTipos(raw: unknown): { ok: true; tipos: TipoConsulta[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'Tipo de consulta inválido' }
  if (raw.length > MAX_TIPOS) return { ok: false, error: 'Máximo de 20 tipos' }
  const seen = new Set<string>()
  const tipos: TipoConsulta[] = []
  for (const r of raw) {
    const t = parseTipo(r)
    if (!t || seen.has(t.id)) return { ok: false, error: 'Tipo de consulta inválido' }
    seen.add(t.id)
    tipos.push(t)
  }
  return { ok: true, tipos }
}

// ── regras ──

function inRange(v: unknown, min: number, max: number): v is number {
  return isInt(v) && v >= min && v <= max
}
function isIntervalo(v: unknown): v is 15 | 30 | 60 {
  return v === 15 || v === 30 || v === 60
}

export function normalizeRegras(raw: unknown): RegrasAgendamento {
  const o = asObj(raw)
  return {
    antecedencia_h: inRange(o.antecedencia_h, 0, 168) ? o.antecedencia_h : REGRAS_PADRAO.antecedencia_h,
    dias_a_frente: inRange(o.dias_a_frente, 1, 90) ? o.dias_a_frente : REGRAS_PADRAO.dias_a_frente,
    intervalo_min: isIntervalo(o.intervalo_min) ? o.intervalo_min : REGRAS_PADRAO.intervalo_min,
  }
}

export function validateRegras(raw: unknown): { ok: true; regras: RegrasAgendamento } | { ok: false; error: string } {
  const o = asObj(raw)
  if (!inRange(o.antecedencia_h, 0, 168) || !inRange(o.dias_a_frente, 1, 90) || !isIntervalo(o.intervalo_min)) {
    return { ok: false, error: 'Regras de agendamento inválidas' }
  }
  return { ok: true, regras: { antecedencia_h: o.antecedencia_h, dias_a_frente: o.dias_a_frente, intervalo_min: o.intervalo_min } }
}

// ── working_hours ──

function parseDay(v: unknown): [string, string][] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > 2) return null
  const ranges: [string, string][] = []
  for (const r of v) {
    if (!Array.isArray(r) || r.length !== 2 || typeof r[0] !== 'string' || typeof r[1] !== 'string') return null
    if (!HHMM.test(r[0]) || !HHMM.test(r[1]) || r[0] >= r[1]) return null
    ranges.push([r[0], r[1]])
  }
  ranges.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  if (ranges.length === 2 && ranges[0][1] > ranges[1][0]) return null
  return ranges
}

export function normalizeWorkingHours(raw: unknown): WorkingHours {
  const o = asObj(raw)
  const out: WorkingHours = {}
  for (const d of DAYS) {
    const r = parseDay(o[d])
    if (r) out[d] = r
  }
  return out
}

export function validateWorkingHours(raw: unknown): { ok: true; hours: WorkingHours } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, hours: {} }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Horário de trabalho inválido' }
  const o = raw as Record<string, unknown>
  for (const [k, v] of Object.entries(o)) {
    if (!DAYS.includes(k as DayKey) || !parseDay(v)) return { ok: false, error: 'Horário de trabalho inválido' }
  }
  return { ok: true, hours: normalizeWorkingHours(raw) }
}
