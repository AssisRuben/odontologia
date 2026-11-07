import { formatHours, type AgentConfig } from './config'
import { HISTORY_LIMIT } from './conversa'
import { diaCurto, type Oferta } from './agendamento/ofertas'

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
  tipos: { nome: string; duracao_min: number }[]
  consultas: { alias: string; start: string; procedure: string | null; professional: string | null }[]
  ofertas: Oferta[]
  antecedenciaH: number
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

const MASKED_TYPES = new Set(['charge', 'payment_due', 'budget', 'budget_reminder'])
export const MASKED_BODY = '[mensagem automática de cobrança ou orçamento]'

/** Texto que vai à IA: cobranças e orçamentos (valores) não são enviados. */
export function historyBody(type: string, body: string): string {
  return MASKED_TYPES.has(type) ? MASKED_BODY : body
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

function formatWhen(start: string, tz: string): string {
  const d = new Date(start)
  const p = parts(d, tz, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  return `${diaCurto(d, tz)} ${p.day}/${p.month} ${p.hour}:${p.minute}`
}

function formatConsulta(c: AgentContextInput['consultas'][number], tz: string): string {
  const base = `${c.alias} = ${formatWhen(c.start, tz)}${c.procedure ? ` ${c.procedure}` : ''}`
  return c.professional ? `${base} com ${c.professional}` : base
}

function formatOfertas(ofertas: Oferta[], now: Date, tz: string): string {
  const vigentes = ofertas.filter((o) => new Date(o.expires_at).getTime() > now.getTime())
  if (!vigentes.length) return 'Opções oferecidas: nenhuma'
  const ate = Math.min(...vigentes.map((o) => new Date(o.expires_at).getTime()))
  const p = parts(new Date(ate), tz, { hour: '2-digit', minute: '2-digit' })
  const itens = vigentes.map((o) => `${o.n}) ${formatWhen(o.start, tz)} ${o.professional_name}`)
  return `Opções oferecidas (válidas até ${p.hour}:${p.minute}): ${itens.join('; ')}`
}

export function buildAgentContext(input: AgentContextInput): string {
  const { clinic, contact, tipos, consultas, ofertas, antecedenciaH, history, now } = input
  const contactLine = contact.kind === 'patient'
    ? `paciente ${contact.firstName}`
    : `contato novo (nome: ${contact.name || 'não informado'})`
  const appts = consultas.slice(0, 3).map((c) => formatConsulta(c, clinic.timezone))
  const lines = [
    `Clínica: ${clinic.name} · Endereço: ${clinic.address || 'não informado'} · Telefone: ${clinic.phone || 'não informado'}`,
    `Convênios aceitos: ${clinic.insurances.length ? clinic.insurances.join(', ') : 'nenhum cadastrado'}`,
    `Horário: ${formatHours(clinic.config.hours)}`,
    `Data e hora agora: ${formatNow(now, clinic.timezone)}`,
    'Informações da clínica:',
    clinic.config.info.trim() || '(nenhuma)',
    '',
    `Contato: ${contactLine}`,
    `Tipos de consulta que você pode marcar: ${tipos.length ? tipos.map((t) => `${t.nome} (${t.duracao_min} min)`).join('; ') : 'nenhum (não marque; passe para a recepção)'}`,
    `Próximas consultas do paciente: ${appts.length ? appts.join('; ') : 'nenhuma'}`,
    formatOfertas(ofertas, now, clinic.timezone),
    `Antecedência mínima para marcar, remarcar ou desmarcar: ${antecedenciaH} h`,
    '',
    `Conversa (mais antiga primeiro, até ${HISTORY_LIMIT}):`,
    ...history.slice(-HISTORY_LIMIT).map((h) => `${ROLE_LABEL[h.role]} ${h.body}`),
  ]
  return lines.join('\n')
}
