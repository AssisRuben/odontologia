import { buildContext } from '@/lib/messaging/templates'
import { todayYmd, zonedDateTime } from '@/lib/messaging/time'
import type { MessageKind, MessageSetting, MessageStatus, MessageType, TemplateContext } from '@/lib/messaging/types'

export const DEFAULT_TZ = 'America/Sao_Paulo'
export const PAGE_SIZE = 50

export const SETTING_ORDER: MessageType[] = ['confirmation', 'reminder', 'recall', 'birthday', 'charge']

export const SETTING_META: Record<MessageType, { title: string; description: string }> = {
  confirmation: { title: 'Confirmação de consulta', description: 'Pede ao paciente que confirme ou desmarque a consulta antes do horário.' },
  reminder: { title: 'Lembrete de consulta', description: 'Avisa o paciente pouco antes da consulta.' },
  recall: { title: 'Retorno semestral', description: 'Lembre seus pacientes de marcar o retorno após a última consulta.' },
  birthday: { title: 'Aniversariantes', description: 'Envie felicitações automáticas no dia do aniversário dos seus pacientes.' },
  charge: { title: 'Inadimplentes', description: 'Notifique pacientes com pagamentos em atraso.' },
}

export const KIND_LABELS: Record<MessageKind, string> = {
  confirmation: 'Confirmação',
  reminder: 'Lembrete',
  recall: 'Retorno',
  birthday: 'Aniversário',
  charge: 'Cobrança',
  manual: 'Manual',
  auto_reply: 'Resposta automática',
  incoming: 'Recebida',
}

export const STATUS_LABELS: Record<MessageStatus, string> = {
  queued: 'Na fila',
  sending: 'Enviando',
  sent: 'Enviada',
  failed: 'Falhou',
  cancelled: 'Cancelada',
  received: 'Recebida',
}

export const STATUS_STYLES: Record<MessageStatus, string> = {
  queued: 'bg-gray-100 text-gray-700',
  sending: 'bg-blue-50 text-blue-700',
  sent: 'bg-green-50 text-green-700',
  failed: 'bg-red-50 text-red-700',
  cancelled: 'bg-yellow-50 text-yellow-800',
  received: 'bg-indigo-50 text-indigo-700',
}

export const REPLY_LABELS: Record<string, string> = {
  confirmed: 'Confirmou',
  cancelled: 'Desmarcou',
}

export interface ConfigForm {
  offset: string // horas / meses (confirmation, reminder, recall)
  days: string[] // charge: dois campos
}

export type ConfigResult =
  | { ok: true; config: MessageSetting['config'] }
  | { ok: false; error: string }

function parseIntInRange(raw: string, min: number, max: number): number | null {
  const s = raw.trim()
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  return n >= min && n <= max ? n : null
}

export function validateConfig(type: MessageType, form: ConfigForm): ConfigResult {
  switch (type) {
    case 'confirmation':
    case 'reminder': {
      const n = parseIntInRange(form.offset, 1, 72)
      return n === null
        ? { ok: false, error: 'Informe as horas antes como um número inteiro de 1 a 72.' }
        : { ok: true, config: { offset_hours: n } }
    }
    case 'recall': {
      const n = parseIntInRange(form.offset, 1, 24)
      return n === null
        ? { ok: false, error: 'Informe os meses como um número inteiro de 1 a 24.' }
        : { ok: true, config: { offset_months: n } }
    }
    case 'charge': {
      const nums = form.days.map((d) => parseIntInRange(d, 1, 60))
      if (nums.length === 0 || nums.some((n) => n === null)) {
        return { ok: false, error: 'Informe os dias após o vencimento como números inteiros de 1 a 60.' }
      }
      const unique = [...new Set(nums as number[])].sort((a, b) => a - b)
      return { ok: true, config: { offset_days: unique } }
    }
    case 'birthday':
      return { ok: true, config: {} }
  }
}

/** Valores iniciais dos campos do formulário a partir da config salva. */
export function configToForm(type: MessageType, config: MessageSetting['config']): ConfigForm {
  if (type === 'recall') return { offset: String(config.offset_months ?? 6), days: [] }
  if (type === 'charge') {
    const d = config.offset_days?.length ? config.offset_days : [1, 7]
    return { offset: '', days: [String(d[0] ?? 1), String(d[1] ?? 7)] }
  }
  if (type === 'confirmation') return { offset: String(config.offset_hours ?? 24), days: [] }
  if (type === 'reminder') return { offset: String(config.offset_hours ?? 2), days: [] }
  return { offset: '', days: [] }
}

function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10)
}

/** Contexto da prévia: paciente fictício, consulta amanhã 14:30 e cobrança vencida há 3 dias. */
export function buildPreviewContext(clinicName: string, tz: string = DEFAULT_TZ, now: Date = new Date()): TemplateContext {
  const today = todayYmd(now, tz)
  const start = zonedDateTime(addDaysYmd(today, 1), '14:30', tz)
  return buildContext({
    patient: { id: 'preview', name: 'Maria Silva Santos', phone: null, whatsapp: null, birthdate: null, whatsapp_opt_out: false },
    clinicName,
    tz,
    appointment: { id: 'preview', patient_id: 'preview', professional_name: 'Dra. Ana Ferreira', start_time: start.toISOString(), status: 'scheduled' },
    payment: { id: 'preview', patient_id: 'preview', amount: 150, due_date: addDaysYmd(today, -3), status: 'pending' },
  })
}

/** Insere `text` entre start e end, devolvendo o novo valor e a posição do cursor. */
export function insertAtCursor(value: string, start: number, end: number, text: string) {
  return { value: value.slice(0, start) + text + value.slice(end), cursor: start + text.length }
}
