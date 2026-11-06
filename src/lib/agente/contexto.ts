import { formatHours, type AgentConfig } from './config'
import { HISTORY_LIMIT, MAX_NEXT_APPOINTMENTS } from './conversa'

export type HistoryItem = {
  role: 'paciente' | 'assistente' | 'equipe' | 'automatica'
  body: string
}

export type AgentContextInput = {
  clinic: {
    name: string
    address: string | null
    phone: string | null
    insurances: string[]
    config: AgentConfig
    timezone: string
  }
  contact: { kind: 'patient'; firstName: string } | { kind: 'new'; name: string | null }
  nextAppointments: { start: string; professional: string | null }[]
  history: HistoryItem[]
  now: Date
}

const ROLE_LABEL: Record<HistoryItem['role'], string> = {
  paciente: '[paciente]',
  assistente: '[assistente]',
  equipe: '[equipe]',
  automatica: '[automática]',
}

export function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? ''
}

export function historyRole(m: { direction: 'in' | 'out'; type: string }): HistoryItem['role'] {
  if (m.direction === 'in') return 'paciente'
  if (m.type === 'agent') return 'assistente'
  if (m.type === 'human' || m.type === 'manual') return 'equipe'
  return 'automatica'
}

function parts(date: Date, timeZone: string, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of new Intl.DateTimeFormat('pt-BR', { timeZone, hourCycle: 'h23', ...opts }).formatToParts(date)) {
    out[p.type] = p.value
  }
  return out
}

function formatNow(date: Date, tz: string): string {
  const p = parts(date, tz, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  return `${p.weekday}, ${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`
}

function formatAppointment(a: { start: string; professional: string | null }, tz: string): string {
  const p = parts(new Date(a.start), tz, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const when = `${p.day}/${p.month} ${p.hour}:${p.minute}`
  return a.professional ? `${when} com ${a.professional}` : when
}

export function buildAgentContext(input: AgentContextInput): string {
  const { clinic, contact, nextAppointments, history, now } = input
  const contactLine = contact.kind === 'patient'
    ? `paciente ${contact.firstName}`
    : `contato novo (nome: ${contact.name || 'não informado'})`
  const appts = nextAppointments.slice(0, MAX_NEXT_APPOINTMENTS).map((a) => formatAppointment(a, clinic.timezone))
  const lines = [
    `Clínica: ${clinic.name} · Endereço: ${clinic.address || 'não informado'} · Telefone: ${clinic.phone || 'não informado'}`,
    `Convênios aceitos: ${clinic.insurances.length ? clinic.insurances.join(', ') : 'nenhum cadastrado'}`,
    `Horário: ${formatHours(clinic.config.hours)}`,
    `Data e hora agora: ${formatNow(now, clinic.timezone)}`,
    'Informações da clínica:',
    clinic.config.info.trim() || '(nenhuma)',
    '',
    `Contato: ${contactLine}`,
    `Próximas consultas: ${appts.length ? appts.join('; ') : 'nenhuma'}`,
    '',
    `Conversa (mais antiga primeiro, até ${HISTORY_LIMIT}):`,
    ...history.slice(-HISTORY_LIMIT).map((h) => `${ROLE_LABEL[h.role]} ${h.body}`),
  ]
  return lines.join('\n')
}
