import { MAX_REPLY_CHARS, REASON_TAKEN_OVER } from './conversa'

export type Filtro = 'aguardando' | 'agente' | 'todas'
export type Resultado = { status: number; body: unknown }

export const NOT_FOUND = { error: 'Conversa não encontrada' }
export const INVALID_ID = { error: 'Conversa inválida' }

export function parseFiltro(v: string | null): Filtro {
  return v === 'agente' || v === 'todas' ? v : 'aguardando'
}

export function parseResposta(body: unknown): { ok: true; texto: string } | { ok: false; error: string } {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>).texto : undefined
  const texto = typeof raw === 'string' ? raw.trim() : ''
  if (!texto || texto.length > MAX_REPLY_CHARS) return { ok: false, error: 'Mensagem vazia ou longa demais' }
  return { ok: true, texto }
}

export function parseNome(body: unknown): { ok: true; name: string } | { ok: false; error: string } {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>).name : undefined
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (name.length < 2 || name.length > 120) return { ok: false, error: 'Nome inválido' }
  return { ok: true, name }
}

export type CaixaConversation = {
  id: string
  phone: string
  patient_id: string | null
  handler: 'agent' | 'human'
  contact_name: string | null
}

export type ResponderDeps = {
  loadConversation(clinicId: string, id: string): Promise<CaixaConversation | null>
  getConnection(clinicId: string): Promise<{ instance: string; token: string; status: string } | null>
  send(conn: { instance: string; token: string }, row: Record<string, unknown> & { phone: string; body: string }): Promise<{ ok: boolean }>
  /** Marca como lida e, com motivo, passa para a equipe (motivo null mantém o handler). */
  markAnswered(conversationId: string, takeOverReason: string | null): Promise<void>
}

export async function responderConversa(
  deps: ResponderDeps,
  clinicId: string,
  id: string,
  texto: string,
): Promise<Resultado> {
  const conv = await deps.loadConversation(clinicId, id)
  if (!conv) return { status: 404, body: NOT_FOUND }
  const conn = await deps.getConnection(clinicId)
  if (!conn || conn.status !== 'connected') return { status: 409, body: { error: 'WhatsApp desconectado' } }
  const row = {
    clinic_id: clinicId,
    patient_id: conv.patient_id,
    conversation_id: conv.id,
    type: 'human',
    direction: 'out',
    phone: conv.phone,
    body: texto,
  }
  const res = await deps.send({ instance: conn.instance, token: conn.token }, row)
  if (!res.ok) return { status: 502, body: { error: 'Não foi possível enviar. Tente de novo.' } }
  // A mensagem já saiu: falha ao marcar a conversa não pode virar erro (a equipe reenviaria).
  try {
    await deps.markAnswered(conv.id, conv.handler === 'agent' ? REASON_TAKEN_OVER : null)
  } catch (e) {
    console.error('[conversas] falha ao marcar como respondida:', e instanceof Error ? e.name : 'erro')
  }
  return { status: 200, body: { ok: true } }
}

export type PacienteDeps = {
  loadConversation(clinicId: string, id: string): Promise<CaixaConversation | null>
  createPatient(clinicId: string, name: string, phone: string): Promise<string>
  linkPatient(conversationId: string, patientId: string): Promise<void>
}

export async function cadastrarPaciente(
  deps: PacienteDeps,
  clinicId: string,
  id: string,
  name: string,
): Promise<Resultado> {
  const conv = await deps.loadConversation(clinicId, id)
  if (!conv) return { status: 404, body: NOT_FOUND }
  if (conv.patient_id) return { status: 409, body: { error: 'Conversa já ligada a um paciente' } }
  const patientId = await deps.createPatient(clinicId, name, conv.phone)
  await deps.linkPatient(conv.id, patientId)
  return { status: 200, body: { patientId } }
}
