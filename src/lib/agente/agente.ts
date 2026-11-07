import type { Conversation } from '@/types'
import type { AiClient } from '@/lib/ia/openai'
import { AiError } from '@/lib/ia/erros'
import type { UsageRow } from '@/lib/ia/uso'
import type { AgentConfig } from './config'
import {
  DEBOUNCE_MS,
  MAX_AGENT_REPLIES_24H,
  REASON_FLOOD,
  REASON_OPT_OUT,
  shouldResume,
} from './conversa'
import { buildAgentContext, firstName, type AgentContextInput, type HistoryItem } from './contexto'
import { AGENT_SYSTEM, AgentOutputSchema, validateAgentOutput, type AgentDecision } from './esquema'

export type AgentConversation = Pick<
  Conversation,
  'id' | 'clinic_id' | 'phone' | 'patient_id' | 'contact_name' | 'handler' | 'last_message_at'
>

export type AgentClinic = {
  name: string
  address: string | null
  phone: string | null
  insurances: string[]
  config: AgentConfig
  timezone: string
  whatsappConnected: boolean
}

export interface AgentDeps {
  sleep(ms: number): Promise<void>
  loadConversation(id: string): Promise<AgentConversation | null>
  latestIncomingId(conversationId: string): Promise<string | null>
  loadClinic(clinicId: string): Promise<AgentClinic>
  loadPatient(patientId: string): Promise<{ name: string; optOut: boolean } | null>
  nextAppointments(clinicId: string, patientId: string, now: Date): Promise<{ start: string; professional: string | null }[]>
  history(clinicId: string, phone: string): Promise<HistoryItem[]>
  agentRepliesSince(conversationId: string, since: Date): Promise<number>
  getAi(clinicId: string): Promise<{ client: AiClient; model: string } | null>
  setHandler(conversationId: string, handler: 'agent' | 'human', reason: string | null): Promise<void>
  setContactName(conversationId: string, name: string): Promise<void>
  markUnread(conversationId: string): Promise<void>
  markRead(conversationId: string): Promise<void>
  lastActivityBefore(clinicId: string, phone: string, messageId: string): Promise<string | null>
  sendAgentMessage(conv: AgentConversation, body: string): Promise<boolean>
  recordUsage(clinicId: string, row: UsageRow): Promise<void>
}

export type AgentResult =
  | 'superseded' | 'missing' | 'disabled' | 'human' | 'opt_out' | 'no_key'
  | 'limit' | 'error' | 'replied' | 'named' | 'handed_off'

const DAY_MS = 24 * 3_600_000

function usageRow(model: string, ok: boolean, input: number | null, output: number | null): UsageRow {
  return { kind: 'agente', model, audio_seconds: null, input_tokens: input, output_tokens: output, ok }
}

function contextoAgenda(clinic: AgentClinic) {
  return {
    tipos: clinic.config.tipos.filter((t) => t.ativo).map((t) => ({ nome: t.nome, duracao_min: t.duracao_min })),
    ofertas: [],
    antecedenciaH: clinic.config.agendamento.antecedencia_h,
  }
}

function contextClinic(clinic: AgentClinic): AgentContextInput['clinic'] {
  return {
    name: clinic.name, address: clinic.address, phone: clinic.phone,
    insurances: clinic.insurances, config: clinic.config, timezone: clinic.timezone,
  }
}

export async function runAgent(
  deps: AgentDeps,
  conversationId: string,
  messageId: string,
  now: () => Date,
): Promise<AgentResult> {
  await deps.sleep(DEBOUNCE_MS)
  if ((await deps.latestIncomingId(conversationId)) !== messageId) return 'superseded'

  const loaded = await deps.loadConversation(conversationId)
  if (!loaded) return 'missing'
  let conv: AgentConversation = loaded

  const clinic = await deps.loadClinic(conv.clinic_id)
  if (!clinic.config.enabled || !clinic.whatsappConnected) return 'disabled'

  if (conv.handler === 'human') {
    // last_message_at já foi atualizado pela mensagem nova; a retomada olha a atividade anterior a ela.
    const before = await deps.lastActivityBefore(conv.clinic_id, conv.phone, messageId)
    if (before !== null && !shouldResume({ handler: conv.handler, last_message_at: before }, now())) return 'human'
    await deps.setHandler(conv.id, 'agent', null)
    conv = { ...conv, handler: 'agent' }
  }

  const patient = conv.patient_id ? await deps.loadPatient(conv.patient_id) : null
  if (patient?.optOut) {
    await deps.setHandler(conv.id, 'human', REASON_OPT_OUT)
    return 'opt_out'
  }

  const since = new Date(now().getTime() - DAY_MS)
  if ((await deps.agentRepliesSince(conv.id, since)) >= MAX_AGENT_REPLIES_24H) {
    await deps.setHandler(conv.id, 'human', REASON_FLOOD)
    return 'limit'
  }

  const ai = await deps.getAi(conv.clinic_id)
  if (!ai) {
    await deps.markUnread(conv.id)
    return 'no_key'
  }

  const fail = async (input: number | null = null, output: number | null = null): Promise<AgentResult> => {
    await deps.markUnread(conv.id)
    await deps.recordUsage(conv.clinic_id, usageRow(ai.model, false, input, output))
    return 'error'
  }

  let decision: AgentDecision | null
  let inputTokens: number
  let outputTokens: number
  try {
    const at = now()
    const [nextAppointments, history] = await Promise.all([
      conv.patient_id && patient ? deps.nextAppointments(conv.clinic_id, conv.patient_id, at) : Promise.resolve([]),
      deps.history(conv.clinic_id, conv.phone),
    ])
    const user = buildAgentContext({
      clinic: contextClinic(clinic),
      contact: patient
        ? { kind: 'patient', firstName: firstName(patient.name) }
        : { kind: 'new', name: conv.contact_name },
      ...contextoAgenda(clinic),
      consultas: nextAppointments.map((a, i) => ({
        alias: `C${i + 1}`, start: a.start, procedure: null, professional: a.professional,
      })),
      history,
      now: at,
    })
    const out = await ai.client.organize({
      model: ai.model, schema: AgentOutputSchema, name: 'agente', system: AGENT_SYSTEM, user,
    })
    inputTokens = out.inputTokens
    outputTokens = out.outputTokens
    decision = validateAgentOutput(out.data)
  } catch (e) {
    console.error('[agente] falha na IA:', e instanceof AiError ? e.kind : 'erro')
    return fail()
  }
  if (!decision) return fail(inputTokens, outputTokens)

  // A recepção pode ter assumido a conversa enquanto a IA pensava.
  const fresh = await deps.loadConversation(conv.id)
  if (!fresh || fresh.handler !== 'agent') {
    await deps.recordUsage(conv.clinic_id, usageRow(ai.model, true, inputTokens, outputTokens))
    return 'human'
  }
  // O paciente pode ter mandado outra mensagem: a execução dela responde por todas.
  if ((await deps.latestIncomingId(conv.id)) !== messageId) {
    await deps.recordUsage(conv.clinic_id, usageRow(ai.model, true, inputTokens, outputTokens))
    return 'superseded'
  }

  let sent = false
  try {
    sent = await deps.sendAgentMessage(fresh, decision.resposta)
  } catch (e) {
    console.error('[agente] falha no envio:', e instanceof Error ? e.name : 'erro')
  }
  if (!sent) return fail(inputTokens, outputTokens)

  await deps.recordUsage(conv.clinic_id, usageRow(ai.model, true, inputTokens, outputTokens))
  if (decision.acao !== 'passar_recepcao') await deps.markRead(conv.id)
  if (decision.acao === 'guardar_nome') {
    await deps.setContactName(conv.id, decision.nome)
    return 'named'
  }
  if (decision.acao === 'passar_recepcao') {
    await deps.setHandler(conv.id, 'human', decision.motivo)
    return 'handed_off'
  }
  return 'replied'
}

export async function simulateAgent(
  deps: Pick<AgentDeps, 'loadClinic' | 'getAi' | 'recordUsage'>,
  clinicId: string,
  texto: string,
  now: Date,
): Promise<AgentDecision | 'no_key'> {
  const ai = await deps.getAi(clinicId)
  if (!ai) return 'no_key'
  const clinic = await deps.loadClinic(clinicId)
  const user = buildAgentContext({
    clinic: contextClinic(clinic),
    contact: { kind: 'new', name: null },
    ...contextoAgenda(clinic),
    consultas: [],
    history: [{ role: 'paciente', body: texto }],
    now,
  })
  let out
  try {
    out = await ai.client.organize({
      model: ai.model, schema: AgentOutputSchema, name: 'agente', system: AGENT_SYSTEM, user,
    })
  } catch (e) {
    await deps.recordUsage(clinicId, usageRow(ai.model, false, null, null))
    throw e
  }
  const decision = validateAgentOutput(out.data)
  await deps.recordUsage(clinicId, usageRow(ai.model, !!decision, out.inputTokens, out.outputTokens))
  if (!decision) throw new AiError('bad_output')
  return decision
}
