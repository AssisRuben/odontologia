import type { Conversation } from '@/types'
import { formatPhone } from '@/lib/utils'

export const DEBOUNCE_MS = 5000
export const OUTGOING_RECHECK_MS = 3000
export const HANDOFF_RESUME_MS = 12 * 3_600_000
export const MAX_AGENT_REPLIES_24H = 30
export const HISTORY_LIMIT = 20
export const MAX_INCOMING_CHARS = 2000
export const MAX_WA_AUDIO_SECONDS = 300
export const MAX_REPLY_CHARS = 1000
export const MAX_NAME_CHARS = 80
export const MAX_REASON_CHARS = 120
export const MAX_NEXT_APPOINTMENTS = 3

export const TEXT_AUDIO = '[áudio]'
export const TEXT_AUDIO_UNTRANSCRIBED = '[áudio não transcrito]'

export const REASON_OPT_OUT = 'Paciente pediu para não receber WhatsApp'
export const REASON_FLOOD = 'Muitas mensagens seguidas'
export const REASON_CLINIC_PHONE = 'Respondido pelo celular da clínica'
export const REASON_TAKEN_OVER = 'Assumida pela equipe'
export const REASON_DEFAULT = 'Pedido do paciente'

export function shouldResume(
  c: Pick<Conversation, 'handler' | 'last_message_at'>,
  now: Date,
): boolean {
  if (c.handler !== 'human') return false
  return now.getTime() - new Date(c.last_message_at).getTime() >= HANDOFF_RESUME_MS
}

export function truncateIncoming(text: string): string {
  return text.trim().slice(0, MAX_INCOMING_CHARS)
}

export function contactLabel(c: {
  patientName: string | null
  contact_name: string | null
  phone: string
}): string {
  if (c.patientName) return c.patientName
  if (c.contact_name) return `Contato novo · ${c.contact_name}`
  const digits = c.phone.replace(/\D/g, '')
  const national = (digits.length === 12 || digits.length === 13) && digits.startsWith('55') ? digits.slice(2) : digits
  return `Contato novo · ${formatPhone(national)}`
}
