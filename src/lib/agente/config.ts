export const AGENT_INFO_MAX = 4000

export type DayKey = '0' | '1' | '2' | '3' | '4' | '5' | '6'
export type AgentConfig = {
  enabled: boolean
  hours: Partial<Record<DayKey, [string, string]>>
  info: string
}

const DAYS: DayKey[] = ['0', '1', '2', '3', '4', '5', '6']
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const LABELS: Record<DayKey, string> = { '0': 'Dom', '1': 'Seg', '2': 'Ter', '3': 'Qua', '4': 'Qui', '5': 'Sex', '6': 'Sáb' }
const ORDER: DayKey[] = ['1', '2', '3', '4', '5', '6', '0']

function validRange(v: unknown): v is [string, string] {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string'
    && HHMM.test(v[0]) && HHMM.test(v[1]) && v[0] < v[1]
}

function asObj(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

export function normalizeAgentConfig(raw: unknown): AgentConfig {
  const o = asObj(raw)
  const h = asObj(o.hours)
  const hours: AgentConfig['hours'] = {}
  for (const d of DAYS) {
    const v = h[d]
    if (validRange(v)) hours[d] = [v[0], v[1]]
  }
  const info = typeof o.info === 'string' ? o.info.trim().slice(0, AGENT_INFO_MAX) : ''
  return { enabled: o.enabled === true, hours, info }
}

export function validateAgentConfig(
  raw: unknown,
): { ok: true; config: AgentConfig } | { ok: false; error: string } {
  const o = asObj(raw)
  const h = asObj(o.hours)
  for (const [k, v] of Object.entries(h)) {
    if (!DAYS.includes(k as DayKey) || !validRange(v)) return { ok: false, error: 'Horário inválido' }
  }
  if (typeof o.info === 'string' && o.info.trim().length > AGENT_INFO_MAX) {
    return { ok: false, error: 'Texto longo demais (máximo 4.000 caracteres)' }
  }
  return { ok: true, config: normalizeAgentConfig(raw) }
}

export function formatHours(hours: AgentConfig['hours']): string {
  return ORDER.map((d) => {
    const r = hours[d]
    return r ? `${LABELS[d]} ${r[0]}–${r[1]}` : `${LABELS[d]} fechado`
  }).join('; ')
}
