import type { AgentConfig } from '../config'
import type { AgentDecision, Alias } from '../esquema'
import type { RegrasAgendamento, TipoConsulta } from './config'
import { calcularHorarios, type Ocupado, type ProfissionalAgenda } from './horarios'
import { MAX_FUTURE_WA_APPOINTMENTS, MAX_SEARCHES_24H } from './limites'
import {
  criarOfertas, ofertaValida, textoDesmarcada, textoLista, textoMarcada, textoRemarcada,
  TEXTO_NOME, TEXTO_OCUPADO, TEXTO_VENCIDA,
  type ConsultaFutura, type Oferta,
} from './ofertas'
import { escolherOfertas, type Preferencia } from './preferencia'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

export type BookingDraft = { tipo: string; replace_appointment_id: string | null }

export type GravarArgs = {
  clinicId: string
  patientId: string
  professionalId: string
  start: string
  end: string
  procedure: string
  replaceId: string | null
}
export type GravarResultado = { ok: true; id: string } | { ok: false; erro: 'HORARIO_OCUPADO' | 'CONSULTA_INVALIDA' }

export interface AgendaDeps {
  carregar(clinicId: string, from: Date, to: Date): Promise<{ profissionais: (ProfissionalAgenda & { whatsappBooking: boolean })[]; ocupados: Ocupado[] }>
  salvarEstado(clinicId: string, conversationId: string, estado: { offers: Oferta[]; booking_draft: BookingDraft | null; searches: string[] }): Promise<void>
  criarPaciente(clinicId: string, nome: string, phone: string): Promise<string>
  /** Liga o paciente à conversa (se ainda sem paciente) e devolve o paciente que ficou ligado a ela. */
  ligarPaciente(clinicId: string, conversationId: string, patientId: string): Promise<string>
  contarFuturasWhatsapp(clinicId: string, patientId: string, now: Date): Promise<number>
  gravar(args: GravarArgs): Promise<GravarResultado>
  desmarcar(clinicId: string, patientId: string, appointmentId: string): Promise<boolean>
}

export type EstadoConversa = {
  id: string
  clinic_id: string
  phone: string
  patient_id: string | null
  contact_name: string | null
  offers: Oferta[]
  booking_draft: BookingDraft | null
  searches: string[]
}

export type ContextoAgenda = {
  clinic: {
    address: string | null
    timezone: string
    hours: AgentConfig['hours']
    tipos: TipoConsulta[]
    regras: RegrasAgendamento
  }
  consultas: { alias: Alias; consulta: ConsultaFutura }[]
}

export type ResultadoAgenda = {
  texto: string
  handoff: string | null
  appointmentId: string | null
  agentAction: 'marcada' | 'remarcada' | 'desmarcada' | null
}

export type DecisaoAgenda = Extract<AgentDecision, { acao: 'buscar_horarios' | 'marcar' | 'remarcar' | 'desmarcar' }>

export const MOTIVO_TIPO = 'Tipo de consulta fora da lista'
export const MOTIVO_BUSCAS = 'Muitas buscas de horário'
export const MOTIVO_SEM_HORARIO = 'Sem horário disponível'
export const MOTIVO_LIMITE = 'Limite de consultas pelo WhatsApp'
export const MOTIVO_REMARCAR = 'Remarcação em cima da hora'
export const MOTIVO_DESMARCAR = 'Cancelamento em cima da hora'
export const MOTIVO_ALTERADA = 'Consulta alterada pela clínica'

/** R9: nas passagens vindas da agenda o texto é do app, não da IA. */
export const TEXTO_PASSAGEM = 'Vou passar sua conversa para a recepção, que já te responde.'

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function nomeCompleto(raw: string | null): string | null {
  const nome = (raw ?? '').replace(/\s+/g, ' ').trim()
  return nome.split(' ').filter(Boolean).length >= 2 ? nome : null
}

function juntar(...partes: (string | null)[]): string {
  return partes.filter((p): p is string => !!p).join('\n\n')
}

export async function executarAgenda(
  deps: AgendaDeps,
  conv: EstadoConversa,
  ctx: ContextoAgenda,
  d: DecisaoAgenda,
  now: Date,
): Promise<ResultadoAgenda> {
  const { clinic } = ctx
  const tz = clinic.timezone
  const antecedenciaMs = clinic.regras.antecedencia_h * HOUR_MS
  const buscasRecentes = conv.searches.filter((s) => {
    const t = new Date(s).getTime()
    return Number.isFinite(t) && now.getTime() - t < DAY_MS
  })

  const passar = (motivo: string): ResultadoAgenda => ({ texto: TEXTO_PASSAGEM, handoff: motivo, appointmentId: null, agentAction: null })
  const ativo = (nome: string | null | undefined): TipoConsulta | null => {
    if (!nome) return null
    const q = norm(nome)
    return clinic.tipos.find((t) => t.ativo && norm(t.nome) === q) ?? null
  }
  const consultaDe = (alias: Alias) => ctx.consultas.find((c) => c.alias === alias)?.consulta ?? null
  const foraDaAntecedencia = (c: ConsultaFutura) => new Date(c.start).getTime() - now.getTime() >= antecedenciaMs

  /** Busca horários e grava as ofertas. `automatica` = nova busca feita pelo app (não conta no limite). */
  async function buscar(args: {
    tipoNome: string | null
    preferencia: Preferencia | null
    replaceId: string | null
    aviso: string | null
    automatica: boolean
  }): Promise<ResultadoAgenda> {
    const tipo = ativo(args.tipoNome)
    if (!tipo) return passar(MOTIVO_TIPO)
    if (!args.automatica && buscasRecentes.length >= MAX_SEARCHES_24H) return passar(MOTIVO_BUSCAS)

    const to = new Date(now.getTime() + (clinic.regras.dias_a_frente + 1) * DAY_MS)
    const { profissionais, ocupados } = await deps.carregar(conv.clinic_id, now, to)
    const elegiveis = profissionais.filter((p) => p.whatsappBooking && (tipo.profissionais === null || tipo.profissionais.includes(p.id)))
    if (elegiveis.length === 0) return passar(MOTIVO_SEM_HORARIO)

    const candidatos = calcularHorarios({
      profissionais: elegiveis,
      ocupados,
      clinicHours: clinic.hours,
      regras: clinic.regras,
      duracaoMin: tipo.duracao_min,
      now,
      timezone: tz,
    })
    const { escolhidos, relaxou } = escolherOfertas(candidatos, args.preferencia, tz)
    if (escolhidos.length === 0) return passar(MOTIVO_SEM_HORARIO)

    const offers = criarOfertas(escolhidos, tipo.nome, now)
    await deps.salvarEstado(conv.clinic_id, conv.id, {
      offers,
      booking_draft: { tipo: tipo.nome, replace_appointment_id: args.replaceId },
      searches: [...buscasRecentes, now.toISOString()],
    })
    // R9: só a busca pedida pela IA leva a resposta dela como introdução; a nova busca automática leva só o aviso.
    const intro = args.automatica ? null : d.resposta
    return { texto: juntar(intro, args.aviso, textoLista(offers, tz, relaxou)), handoff: null, appointmentId: null, agentAction: null }
  }

  /** Oferta escolhida ainda vigente e fora da antecedência mínima. */
  const ofertaEscolhida = (n: number): Oferta | null => {
    const o = ofertaValida(conv.offers, n, now)
    return o && new Date(o.start).getTime() - now.getTime() >= antecedenciaMs ? o : null
  }
  const tipoDaConversa = (): string | null => conv.offers[0]?.tipo ?? conv.booking_draft?.tipo ?? null

  /** Nova busca após oferta vencida/ocupada (R1): sem tipo conhecido, só a resposta da IA. */
  async function buscarDeNovo(aviso: string, tipoNome: string | null, replaceId: string | null): Promise<ResultadoAgenda> {
    if (!tipoNome) return { texto: d.resposta, handoff: null, appointmentId: null, agentAction: null }
    return buscar({ tipoNome, preferencia: null, replaceId, aviso, automatica: true })
  }

  async function gravarOferta(o: Oferta, patientId: string, replaceId: string | null): Promise<ResultadoAgenda> {
    const r = await deps.gravar({
      clinicId: conv.clinic_id,
      patientId,
      professionalId: o.professional_id,
      start: o.start,
      end: o.end,
      procedure: o.tipo,
      replaceId,
    })
    if (!r.ok) {
      if (r.erro === 'HORARIO_OCUPADO') return buscarDeNovo(TEXTO_OCUPADO, o.tipo, replaceId)
      return passar(replaceId ? MOTIVO_ALTERADA : MOTIVO_SEM_HORARIO)
    }
    await deps.salvarEstado(conv.clinic_id, conv.id, { offers: [], booking_draft: null, searches: buscasRecentes })
    const confirmacao = replaceId ? textoRemarcada(o, tz) : textoMarcada(o, clinic.address, tz)
    return { texto: confirmacao, handoff: null, appointmentId: r.id, agentAction: replaceId ? 'remarcada' : 'marcada' }
  }

  switch (d.acao) {
    case 'buscar_horarios': {
      // R6: busca sem consulta é marcação nova; com consulta, remarcação daquela consulta.
      let replaceId: string | null = null
      if (d.consulta) {
        const c = consultaDe(d.consulta)
        if (!c) return passar(MOTIVO_ALTERADA)
        if (!foraDaAntecedencia(c)) return passar(MOTIVO_REMARCAR)
        replaceId = c.id
      }
      return buscar({ tipoNome: d.tipo, preferencia: d.preferencia, replaceId, aviso: null, automatica: false })
    }

    case 'marcar': {
      // R4/R6: remarcação em andamento (rascunho com consulta a substituir) → age como remarcar.
      const draftId = conv.booking_draft?.replace_appointment_id ?? null
      if (draftId) {
        const c = ctx.consultas.find((x) => x.consulta.id === draftId)?.consulta ?? null
        if (!c || !conv.patient_id) return passar(MOTIVO_ALTERADA)
        if (!foraDaAntecedencia(c)) return passar(MOTIVO_REMARCAR)
        const o = ofertaEscolhida(d.opcao)
        if (!o) return buscarDeNovo(TEXTO_VENCIDA, tipoDaConversa(), c.id)
        return gravarOferta(o, conv.patient_id, c.id)
      }

      const o = ofertaEscolhida(d.opcao)
      if (!o) return buscarDeNovo(TEXTO_VENCIDA, tipoDaConversa(), null)

      let patientId = conv.patient_id
      if (!patientId) {
        const nome = nomeCompleto(d.nome) ?? nomeCompleto(conv.contact_name)
        if (!nome) return { texto: TEXTO_NOME, handoff: null, appointmentId: null, agentAction: null }
        const criado = await deps.criarPaciente(conv.clinic_id, nome, conv.phone)
        // M3: outra execução pode ter ligado um paciente à conversa antes: marca para ele.
        const ligado = await deps.ligarPaciente(conv.clinic_id, conv.id, criado)
        if (ligado === criado) return gravarOferta(o, criado, null)
        patientId = ligado
      }
      if ((await deps.contarFuturasWhatsapp(conv.clinic_id, patientId, now)) >= MAX_FUTURE_WA_APPOINTMENTS) {
        return passar(MOTIVO_LIMITE)
      }
      return gravarOferta(o, patientId, null)
    }

    case 'remarcar': {
      const c = consultaDe(d.consulta)
      if (!c || !conv.patient_id || !foraDaAntecedencia(c)) return passar(MOTIVO_REMARCAR)
      const tipoDaConsulta = ativo(c.procedure)?.nome ?? clinic.tipos.find((t) => t.ativo)?.nome ?? null
      if (d.opcao === null) {
        return buscar({ tipoNome: tipoDaConsulta, preferencia: null, replaceId: c.id, aviso: null, automatica: false })
      }
      const o = ofertaEscolhida(d.opcao)
      if (!o) return buscarDeNovo(TEXTO_VENCIDA, tipoDaConversa() ?? tipoDaConsulta, c.id)
      return gravarOferta(o, conv.patient_id, c.id)
    }

    case 'desmarcar': {
      const c = consultaDe(d.consulta)
      if (!c || !conv.patient_id || !foraDaAntecedencia(c)) return passar(MOTIVO_DESMARCAR)
      const ok = await deps.desmarcar(conv.clinic_id, conv.patient_id, c.id)
      if (!ok) return passar(MOTIVO_DESMARCAR)
      return { texto: textoDesmarcada(c, tz), handoff: null, appointmentId: c.id, agentAction: 'desmarcada' }
    }
  }
}
