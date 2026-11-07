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
import { apelidos, TEXTO_FECHO, type ConsultaFutura, type Oferta } from './agendamento/ofertas'
import {
  executarAgenda, type AgendaDeps, type BookingDraft, type ContextoAgenda, type DecisaoAgenda, type ResultadoAgenda,
} from './agendamento/executar'
import { buildAgentContext, firstName, type AgentContextInput, type HistoryItem } from './contexto'
import { AGENT_SYSTEM, AgentOutputSchema, validateAgentOutput, type AgentDecision } from './esquema'

export type AgentConversation = Pick<
  Conversation,
  'id' | 'clinic_id' | 'phone' | 'patient_id' | 'contact_name' | 'handler' | 'last_message_at'
> & { offers: Oferta[]; booking_draft: BookingDraft | null; searches: string[] }

export type AgentMessageExtra = { appointmentId: string; agentAction: 'marcada' | 'remarcada' | 'desmarcada' }

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
  agenda: AgendaDeps
  sleep(ms: number): Promise<void>
  loadConversation(id: string): Promise<AgentConversation | null>
  latestIncomingId(conversationId: string): Promise<string | null>
  loadClinic(clinicId: string): Promise<AgentClinic>
  loadPatient(patientId: string): Promise<{ name: string; optOut: boolean } | null>
  nextAppointments(clinicId: string, patientId: string, now: Date): Promise<ConsultaFutura[]>
  history(clinicId: string, phone: string): Promise<HistoryItem[]>
  agentRepliesSince(conversationId: string, since: Date): Promise<number>
  getAi(clinicId: string): Promise<{ client: AiClient; model: string } | null>
  setHandler(conversationId: string, handler: 'agent' | 'human', reason: string | null): Promise<void>
  setContactName(conversationId: string, name: string): Promise<void>
  markUnread(conversationId: string): Promise<void>
  markRead(conversationId: string): Promise<void>
  lastActivityBefore(clinicId: string, phone: string, messageId: string): Promise<string | null>
  sendAgentMessage(conv: AgentConversation, body: string, extra?: AgentMessageExtra): Promise<boolean>
  recordUsage(clinicId: string, row: UsageRow): Promise<void>
}

export type AgentResult =
  | 'superseded' | 'missing' | 'disabled' | 'human' | 'opt_out' | 'no_key'
  | 'limit' | 'error' | 'replied' | 'named' | 'handed_off'
  | 'offered' | 'booked' | 'rescheduled' | 'cancelled_appt'

const DAY_MS = 24 * 3_600_000

function usageRow(model: string, ok: boolean, input: number | null, output: number | null): UsageRow {
  return { kind: 'agente', model, audio_seconds: null, input_tokens: input, output_tokens: output, ok }
}

function contextoAgenda(clinic: AgentClinic, ofertas: Oferta[]) {
  return {
    tipos: clinic.config.tipos.filter((t) => t.ativo).map((t) => ({ nome: t.nome, duracao_min: t.duracao_min })),
    ofertas,
    antecedenciaH: clinic.config.agendamento.antecedencia_h,
  }
}

function contextoExecucao(clinic: AgentClinic, consultas: ContextoAgenda['consultas']): ContextoAgenda {
  return {
    clinic: {
      address: clinic.address,
      timezone: clinic.timezone,
      hours: clinic.config.hours,
      tipos: clinic.config.tipos,
      regras: clinic.config.agendamento,
    },
    consultas,
  }
}

const ACOES_AGENDA = ['buscar_horarios', 'marcar', 'remarcar', 'desmarcar'] as const
function isAgenda(d: AgentDecision): d is DecisaoAgenda {
  return (ACOES_AGENDA as readonly string[]).includes(d.acao)
}

function estadoDe(c: AgentConversation) {
  return { ...c, offers: c.offers ?? [], booking_draft: c.booking_draft ?? null, searches: c.searches ?? [] }
}

/** As ofertas mostradas à IA ainda são as da conversa? (outra execução pode ter feito nova busca) */
function mesmasOfertas(a: Oferta[], b: Oferta[]): boolean {
  return a.length === b.length && a.every((o, i) => {
    const x = b[i]
    return o.n === x.n && o.start === x.start && o.professional_id === x.professional_id && o.expires_at === x.expires_at
  })
}

function resultadoDe(r: ResultadoAgenda): AgentResult {
  if (r.handoff) return 'handed_off'
  if (r.agentAction === 'marcada') return 'booked'
  if (r.agentAction === 'remarcada') return 'rescheduled'
  if (r.agentAction === 'desmarcada') return 'cancelled_appt'
  return r.texto.includes(TEXTO_FECHO) ? 'offered' : 'replied'
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
  let ctxAgenda: ContextoAgenda
  let inputTokens: number
  let outputTokens: number
  try {
    const at = now()
    const [nextAppointments, history] = await Promise.all([
      conv.patient_id && patient ? deps.nextAppointments(conv.clinic_id, conv.patient_id, at) : Promise.resolve([]),
      deps.history(conv.clinic_id, conv.phone),
    ])
    const consultasAlias = apelidos(nextAppointments)
    ctxAgenda = contextoExecucao(clinic, consultasAlias)
    const user = buildAgentContext({
      clinic: contextClinic(clinic),
      contact: patient
        ? { kind: 'patient', firstName: firstName(patient.name) }
        : { kind: 'new', name: conv.contact_name },
      ...contextoAgenda(clinic, conv.offers ?? []),
      consultas: consultasAlias.map(({ alias, consulta: a }) => ({
        alias, start: a.start, procedure: a.procedure, professional: a.professional,
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

  let texto = decision.resposta
  let extra: AgentMessageExtra | undefined
  let agenda: ResultadoAgenda | null = null
  if (isAgenda(decision)) {
    try {
      const estado = estadoDe(fresh)
      // M4: a IA escolheu entre ofertas que já foram trocadas: conta como vencida (nova busca).
      if (!mesmasOfertas(conv.offers ?? [], estado.offers)) estado.offers = []
      agenda = await executarAgenda(deps.agenda, estado, ctxAgenda!, decision, now())
    } catch (e) {
      console.error('[agente] falha na agenda:', e instanceof Error ? e.name : 'erro')
      return fail(inputTokens, outputTokens)
    }
    texto = agenda.texto
    if (agenda.appointmentId && agenda.agentAction) extra = { appointmentId: agenda.appointmentId, agentAction: agenda.agentAction }
  }

  let sent = false
  try {
    sent = await deps.sendAgentMessage(fresh, texto, extra)
  } catch (e) {
    console.error('[agente] falha no envio:', e instanceof Error ? e.name : 'erro')
  }
  if (!sent) return fail(inputTokens, outputTokens)

  await deps.recordUsage(conv.clinic_id, usageRow(ai.model, true, inputTokens, outputTokens))
  if (agenda) {
    if (agenda.handoff) {
      await deps.setHandler(conv.id, 'human', agenda.handoff)
      return 'handed_off'
    }
    await deps.markRead(conv.id)
    return resultadoDe(agenda)
  }
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
  deps: Pick<AgentDeps, 'loadClinic' | 'getAi' | 'recordUsage' | 'agenda'>,
  clinicId: string,
  texto: string,
  now: Date,
): Promise<(AgentDecision & { ofertas?: Oferta[] }) | 'no_key'> {
  const ai = await deps.getAi(clinicId)
  if (!ai) return 'no_key'
  const clinic = await deps.loadClinic(clinicId)
  const user = buildAgentContext({
    clinic: contextClinic(clinic),
    contact: { kind: 'new', name: null },
    ...contextoAgenda(clinic, []),
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
  if (decision.acao !== 'buscar_horarios') return decision

  // Só calcula as ofertas: nada é salvo nem gravado.
  let ofertas: Oferta[] = []
  const somenteLeitura: AgendaDeps = {
    ...deps.agenda,
    salvarEstado: async (_c, _i, estado) => { ofertas = estado.offers },
    criarPaciente: async () => { throw new Error('somente leitura') },
    ligarPaciente: async () => { throw new Error('somente leitura') },
    gravar: async () => { throw new Error('somente leitura') },
    desmarcar: async () => { throw new Error('somente leitura') },
  }
  const estado = { id: 'simulacao', clinic_id: clinicId, phone: '', patient_id: null, contact_name: null, offers: [], booking_draft: null, searches: [] }
  await executarAgenda(somenteLeitura, estado, contextoExecucao(clinic, []), decision, now)
  return { ...decision, ofertas }
}
