import { describe, it, expect, vi } from 'vitest'
import { executarAgenda, TEXTO_PASSAGEM, type AgendaDeps, type EstadoConversa, type ContextoAgenda } from '@/lib/agente/agendamento/executar'
import { criarOfertas, TEXTO_NOME, TEXTO_VENCIDA, TEXTO_OCUPADO, TEXTO_FECHO, type Oferta } from '@/lib/agente/agendamento/ofertas'
import { TIPOS_PADRAO, REGRAS_PADRAO } from '@/lib/agente/agendamento/config'
import type { AgentDecision } from '@/lib/agente/esquema'

const TZ = 'America/Sao_Paulo'
const now = new Date('2026-11-06T17:00:00Z') // sex 14:00 em SP
const H = 3_600_000

const MANHA: [string, string][] = [['08:00', '12:00']]
const prof = {
  id: 'p1',
  nome: 'Dr. Carlos Mendes',
  workingHours: { '1': MANHA, '2': MANHA, '3': MANHA, '4': MANHA, '5': MANHA },
  whatsappBooking: true,
}

function makeDeps(over: Partial<AgendaDeps> = {}) {
  const deps = {
    carregar: vi.fn<AgendaDeps['carregar']>(async () => ({ profissionais: [prof], ocupados: [] })),
    salvarEstado: vi.fn<AgendaDeps['salvarEstado']>(async () => {}),
    criarPaciente: vi.fn<AgendaDeps['criarPaciente']>(async () => 'pac-novo'),
    ligarPaciente: vi.fn<AgendaDeps['ligarPaciente']>(async (_c, _i, patientId) => patientId),
    contarFuturasWhatsapp: vi.fn<AgendaDeps['contarFuturasWhatsapp']>(async () => 0),
    gravar: vi.fn<AgendaDeps['gravar']>(async () => ({ ok: true as const, id: 'ap-novo' })),
    desmarcar: vi.fn<AgendaDeps['desmarcar']>(async () => true),
  }
  return { ...deps, ...over } as typeof deps
}

const ofertaBase = criarOfertas(
  [
    { professional_id: 'p1', professional_name: 'Dr. Carlos Mendes', start: '2026-11-10T11:30:00Z', end: '2026-11-10T12:00:00Z' },
    { professional_id: 'p1', professional_name: 'Dr. Carlos Mendes', start: '2026-11-10T12:00:00Z', end: '2026-11-10T12:30:00Z' },
  ],
  'Avaliação',
  now,
)

function conv(over: Partial<EstadoConversa> = {}): EstadoConversa {
  return {
    id: 'conv1', clinic_id: 'k1', phone: '5511999990000', patient_id: 'pac1', contact_name: null,
    offers: [], booking_draft: null, searches: [], ...over,
  }
}

const consultaC1 = { id: 'ap1', start: '2026-11-12T13:00:00Z', procedure: 'Retorno', professional: 'Dr. Carlos Mendes' }
const consultaPerto = { id: 'ap2', start: new Date(now.getTime() + 5 * H).toISOString(), procedure: 'Avaliação', professional: 'Dr. Carlos Mendes' }

function ctx(over: Partial<ContextoAgenda['clinic']> = {}, consultas: ContextoAgenda['consultas'] = [{ alias: 'C1', consulta: consultaC1 }]): ContextoAgenda {
  return {
    clinic: {
      address: 'Rua A, 10',
      timezone: TZ,
      hours: { '1': ['08:00', '18:00'], '2': ['08:00', '18:00'], '3': ['08:00', '18:00'], '4': ['08:00', '18:00'], '5': ['08:00', '18:00'] },
      tipos: TIPOS_PADRAO,
      regras: REGRAS_PADRAO,
      ...over,
    },
    consultas,
  }
}

type D = Extract<AgentDecision, { acao: 'buscar_horarios' | 'marcar' | 'remarcar' | 'desmarcar' }>
const buscar = (tipo = 'Avaliação', consulta: 'C1' | null = null): D => ({ acao: 'buscar_horarios', resposta: 'Vou ver os horários.', tipo, preferencia: null, consulta })
const marcar = (opcao = 1, nome: string | null = null): D => ({ acao: 'marcar', resposta: 'Certo!', opcao, nome })

describe('buscar_horarios', () => {
  it('busca grava 5 ofertas e searches; texto contém a lista', async () => {
    const deps = makeDeps()
    const r = await executarAgenda(deps, conv(), ctx(), buscar('avaliacao'), now)
    expect(r.handoff).toBeNull()
    expect(deps.carregar).toHaveBeenCalledWith('k1', now, new Date(now.getTime() + 31 * 24 * H))
    const [clinicId, id, estado] = deps.salvarEstado.mock.calls[0] as unknown as [string, string, { offers: Oferta[]; booking_draft: unknown; searches: string[] }]
    expect(clinicId).toBe('k1')
    expect(id).toBe('conv1')
    expect(estado.offers).toHaveLength(5)
    expect(estado.offers[0].tipo).toBe('Avaliação')
    expect(estado.booking_draft).toEqual({ tipo: 'Avaliação', replace_appointment_id: null })
    expect(estado.searches).toEqual([now.toISOString()])
    expect(r.texto.startsWith('Vou ver os horários.\n\n1) seg 09/11 às 8h com Dr. Carlos Mendes')).toBe(true)
    expect(r.texto.endsWith(TEXTO_FECHO)).toBe(true)
  })

  it('poda buscas com mais de 24 h', async () => {
    const deps = makeDeps()
    const velha = new Date(now.getTime() - 25 * H).toISOString()
    const recente = new Date(now.getTime() - H).toISOString()
    await executarAgenda(deps, conv({ searches: [velha, recente] }), ctx(), buscar(), now)
    const estado = (deps.salvarEstado.mock.calls[0] as unknown as [string, string, { searches: string[] }])[2]
    expect(estado.searches).toEqual([recente, now.toISOString()])
  })

  it('tipo fora da lista → recepção', async () => {
    const deps = makeDeps()
    const r = await executarAgenda(deps, conv(), ctx(), buscar('Clareamento'), now)
    expect(r).toEqual({ texto: TEXTO_PASSAGEM, handoff: 'Tipo de consulta fora da lista', appointmentId: null, agentAction: null })
    expect(deps.salvarEstado).not.toHaveBeenCalled()
  })

  it('tipo inativo → recepção', async () => {
    const deps = makeDeps()
    const tipos = TIPOS_PADRAO.map((t) => (t.nome === 'Avaliação' ? { ...t, ativo: false } : t))
    const r = await executarAgenda(deps, conv(), ctx({ tipos }), buscar(), now)
    expect(r.handoff).toBe('Tipo de consulta fora da lista')
  })

  it('4ª busca em 24 h → recepção', async () => {
    const deps = makeDeps()
    const s = [1, 2, 3].map((h) => new Date(now.getTime() - h * H).toISOString())
    const r = await executarAgenda(deps, conv({ searches: s }), ctx(), buscar(), now)
    expect(r.handoff).toBe('Muitas buscas de horário')
    expect(deps.carregar).not.toHaveBeenCalled()
  })

  it('sem horário → recepção', async () => {
    const deps = makeDeps({ carregar: vi.fn(async () => ({ profissionais: [{ ...prof, whatsappBooking: false }], ocupados: [] })) })
    const r = await executarAgenda(deps, conv(), ctx(), buscar(), now)
    expect(r.handoff).toBe('Sem horário disponível')
    expect(r.texto).toBe('Vou passar sua conversa para a recepção, que já te responde.')
  })

  it('profissional fora do tipo não entra', async () => {
    const deps = makeDeps()
    const tipos = TIPOS_PADRAO.map((t) => ({ ...t, profissionais: ['outro'] }))
    const r = await executarAgenda(deps, conv(), ctx({ tipos }), buscar(), now)
    expect(r.handoff).toBe('Sem horário disponível')
  })

  it('com consulta guarda replace_appointment_id', async () => {
    const deps = makeDeps()
    await executarAgenda(deps, conv(), ctx(), buscar('Retorno', 'C1'), now)
    const estado = (deps.salvarEstado.mock.calls[0] as unknown as [string, string, { booking_draft: unknown }])[2]
    expect(estado.booking_draft).toEqual({ tipo: 'Retorno', replace_appointment_id: 'ap1' })
  })
})

describe('buscar_horarios e rascunho (R6)', () => {
  const estadoDe = (deps: ReturnType<typeof makeDeps>) =>
    (deps.salvarEstado.mock.calls[0] as unknown as [string, string, { booking_draft: unknown }])[2]

  it('busca sem consulta zera replace_appointment_id do rascunho', async () => {
    const deps = makeDeps()
    await executarAgenda(deps, conv({ booking_draft: { tipo: 'Retorno', replace_appointment_id: 'ap1' } }), ctx(), buscar(), now)
    expect(estadoDe(deps).booking_draft).toEqual({ tipo: 'Avaliação', replace_appointment_id: null })
  })

  it('busca com consulta que não existe mais → recepção', async () => {
    const deps = makeDeps()
    const r = await executarAgenda(deps, conv(), ctx({}, []), buscar('Retorno', 'C1'), now)
    expect(r.handoff).toBe('Consulta alterada pela clínica')
    expect(deps.carregar).not.toHaveBeenCalled()
  })

  it('busca com consulta dentro da antecedência → recepção', async () => {
    const deps = makeDeps()
    const r = await executarAgenda(deps, conv(), ctx({}, [{ alias: 'C1', consulta: consultaPerto }]), buscar('Retorno', 'C1'), now)
    expect(r.handoff).toBe('Remarcação em cima da hora')
  })
})

describe('marcar', () => {
  it('paciente cadastrado marca', async () => {
    const deps = makeDeps()
    const r = await executarAgenda(deps, conv({ offers: ofertaBase, searches: ['x'] }), ctx(), marcar(2), now)
    expect(deps.gravar).toHaveBeenCalledWith({
      clinicId: 'k1', patientId: 'pac1', professionalId: 'p1',
      start: '2026-11-10T12:00:00Z', end: '2026-11-10T12:30:00Z', procedure: 'Avaliação', replaceId: null,
    })
    expect(r).toEqual({
      texto: 'Pronto! Avaliação marcada para terça-feira, 10/11, às 9h com Dr. Carlos Mendes. Endereço: Rua A, 10.',
      handoff: null, appointmentId: 'ap-novo', agentAction: 'marcada',
    })
    expect(deps.salvarEstado).toHaveBeenCalledWith('k1', 'conv1', { offers: [], booking_draft: null, searches: [] })
    expect(deps.criarPaciente).not.toHaveBeenCalled()
  })

  it('opção vencida busca de novo', async () => {
    const deps = makeDeps()
    const depois = new Date(now.getTime() + 2 * H + 1000)
    const r = await executarAgenda(deps, conv({ offers: ofertaBase }), ctx(), marcar(1), depois)
    expect(deps.gravar).not.toHaveBeenCalled()
    expect(deps.carregar).toHaveBeenCalledTimes(1)
    expect(r.handoff).toBeNull()
    expect(r.texto.startsWith(`${TEXTO_VENCIDA}\n\n1) `)).toBe(true)
    const estado = (deps.salvarEstado.mock.calls[0] as unknown as [string, string, { offers: Oferta[] }])[2]
    expect(estado.offers.length).toBeGreaterThan(0)
    expect(estado.offers[0].tipo).toBe('Avaliação')
  })

  it('opção vencida sem tipo conhecido devolve só a resposta', async () => {
    const deps = makeDeps()
    const r = await executarAgenda(deps, conv(), ctx(), marcar(1), now)
    expect(r).toEqual({ texto: 'Certo!', handoff: null, appointmentId: null, agentAction: null })
    expect(deps.carregar).not.toHaveBeenCalled()
  })

  it('opção vencida usa o tipo do rascunho', async () => {
    const deps = makeDeps()
    await executarAgenda(deps, conv({ booking_draft: { tipo: 'Retorno', replace_appointment_id: null } }), ctx(), marcar(1), now)
    const estado = (deps.salvarEstado.mock.calls[0] as unknown as [string, string, { offers: Oferta[] }])[2]
    expect(estado.offers[0].tipo).toBe('Retorno')
  })

  it('contato novo sem nome completo pede o nome e nada grava', async () => {
    const deps = makeDeps()
    const r = await executarAgenda(deps, conv({ patient_id: null, contact_name: 'Maria', offers: ofertaBase }), ctx(), marcar(1, 'Maria'), now)
    expect(r).toEqual({ texto: TEXTO_NOME, handoff: null, appointmentId: null, agentAction: null })
    expect(r.texto).toBe('Para marcar, preciso do seu nome completo.')
    expect(deps.criarPaciente).not.toHaveBeenCalled()
    expect(deps.gravar).not.toHaveBeenCalled()
    expect(deps.salvarEstado).not.toHaveBeenCalled()
  })

  it('contato novo com nome completo e opção marca', async () => {
    const deps = makeDeps()
    const r = await executarAgenda(deps, conv({ patient_id: null, offers: ofertaBase }), ctx(), marcar(1, '  Maria   Souza '), now)
    expect(deps.criarPaciente).toHaveBeenCalledWith('k1', 'Maria Souza', '5511999990000')
    expect(deps.ligarPaciente).toHaveBeenCalledWith('k1', 'conv1', 'pac-novo')
    expect(deps.contarFuturasWhatsapp).not.toHaveBeenCalled()
    expect(deps.gravar).toHaveBeenCalledWith(expect.objectContaining({ patientId: 'pac-novo', replaceId: null }))
    expect(r.agentAction).toBe('marcada')
    expect(r.appointmentId).toBe('ap-novo')
  })

  it('contato novo usa o nome da conversa quando completo', async () => {
    const deps = makeDeps()
    await executarAgenda(deps, conv({ patient_id: null, contact_name: 'Maria Souza', offers: ofertaBase }), ctx(), marcar(1, 'Maria'), now)
    expect(deps.criarPaciente).toHaveBeenCalledWith('k1', 'Maria Souza', '5511999990000')
  })

  it('limite de 2 futuras → recepção', async () => {
    const deps = makeDeps({ contarFuturasWhatsapp: vi.fn(async () => 2) })
    const r = await executarAgenda(deps, conv({ offers: ofertaBase }), ctx(), marcar(1), now)
    expect(deps.contarFuturasWhatsapp).toHaveBeenCalledWith('k1', 'pac1', now)
    expect(r.handoff).toBe('Limite de consultas pelo WhatsApp')
    expect(r.texto).toBe(TEXTO_PASSAGEM)
    expect(deps.gravar).not.toHaveBeenCalled()
  })

  it('contato novo ligado em paralelo: marca para o paciente já ligado (M3)', async () => {
    const deps = makeDeps({ ligarPaciente: vi.fn(async () => 'pac-outro') })
    const r = await executarAgenda(deps, conv({ patient_id: null, offers: ofertaBase }), ctx(), marcar(1, 'Maria Souza'), now)
    expect(deps.contarFuturasWhatsapp).toHaveBeenCalledWith('k1', 'pac-outro', now)
    expect(deps.gravar).toHaveBeenCalledWith(expect.objectContaining({ patientId: 'pac-outro' }))
    expect(r.agentAction).toBe('marcada')
  })

  it('contato novo ligado em paralelo com limite atingido → recepção (M3)', async () => {
    const deps = makeDeps({ ligarPaciente: vi.fn(async () => 'pac-outro'), contarFuturasWhatsapp: vi.fn(async () => 2) })
    const r = await executarAgenda(deps, conv({ patient_id: null, offers: ofertaBase }), ctx(), marcar(1, 'Maria Souza'), now)
    expect(r.handoff).toBe('Limite de consultas pelo WhatsApp')
    expect(deps.gravar).not.toHaveBeenCalled()
  })

  it('HORARIO_OCUPADO busca de novo uma vez', async () => {
    const deps = makeDeps({ gravar: vi.fn(async () => ({ ok: false as const, erro: 'HORARIO_OCUPADO' as const })) })
    const r = await executarAgenda(deps, conv({ offers: ofertaBase }), ctx(), marcar(1), now)
    expect(deps.gravar).toHaveBeenCalledTimes(1)
    expect(deps.carregar).toHaveBeenCalledTimes(1)
    expect(r.handoff).toBeNull()
    expect(r.agentAction).toBeNull()
    expect(r.texto.startsWith(`${TEXTO_OCUPADO}\n\n1) `)).toBe(true)

    // segunda vez: a nova busca não acha nada → recepção
    const deps2 = makeDeps({
      gravar: vi.fn(async () => ({ ok: false as const, erro: 'HORARIO_OCUPADO' as const })),
      carregar: vi.fn(async () => ({ profissionais: [], ocupados: [] })),
    })
    const r2 = await executarAgenda(deps2, conv({ offers: ofertaBase }), ctx(), marcar(1), now)
    expect(deps2.gravar).toHaveBeenCalledTimes(1)
    expect(r2).toEqual({ texto: TEXTO_PASSAGEM, handoff: 'Sem horário disponível', appointmentId: null, agentAction: null })
  })

  it('marcar com remarcação em andamento remarca (R4)', async () => {
    const deps = makeDeps({ contarFuturasWhatsapp: vi.fn(async () => 5) })
    const draft = { tipo: 'Avaliação', replace_appointment_id: 'ap1' }
    const r = await executarAgenda(deps, conv({ offers: ofertaBase, booking_draft: draft }), ctx(), marcar(1), now)
    expect(deps.gravar).toHaveBeenCalledWith(expect.objectContaining({ replaceId: 'ap1', start: '2026-11-10T11:30:00Z' }))
    expect(deps.contarFuturasWhatsapp).not.toHaveBeenCalled()
    expect(r).toEqual({
      texto: 'Pronto! Sua consulta foi remarcada para terça-feira, 10/11, às 8h30 com Dr. Carlos Mendes.',
      handoff: null, appointmentId: 'ap-novo', agentAction: 'remarcada',
    })
  })

  it('marcar com rascunho de consulta que sumiu → recepção (R6)', async () => {
    const deps = makeDeps()
    const draft = { tipo: 'Avaliação', replace_appointment_id: 'ap-sumiu' }
    const r = await executarAgenda(deps, conv({ offers: ofertaBase, booking_draft: draft }), ctx(), marcar(1), now)
    expect(r.handoff).toBe('Consulta alterada pela clínica')
    expect(deps.gravar).not.toHaveBeenCalled()
  })

  it('marcar com rascunho de consulta dentro da antecedência → recepção (R6)', async () => {
    const deps = makeDeps()
    const draft = { tipo: 'Avaliação', replace_appointment_id: 'ap2' }
    const r = await executarAgenda(deps, conv({ offers: ofertaBase, booking_draft: draft }), ctx({}, [{ alias: 'C1', consulta: consultaPerto }]), marcar(1), now)
    expect(r.handoff).toBe('Remarcação em cima da hora')
    expect(deps.gravar).not.toHaveBeenCalled()
  })

  it('marcar como remarcação com CONSULTA_INVALIDA → recepção (R5)', async () => {
    const deps = makeDeps({ gravar: vi.fn(async () => ({ ok: false as const, erro: 'CONSULTA_INVALIDA' as const })) })
    const draft = { tipo: 'Avaliação', replace_appointment_id: 'ap1' }
    const r = await executarAgenda(deps, conv({ offers: ofertaBase, booking_draft: draft }), ctx(), marcar(1), now)
    expect(r.handoff).toBe('Consulta alterada pela clínica')
  })

  it('oferta dentro da antecedência conta como vencida', async () => {
    const deps = makeDeps()
    const perto = criarOfertas([{ professional_id: 'p1', professional_name: 'X', start: new Date(now.getTime() + H).toISOString(), end: new Date(now.getTime() + 2 * H).toISOString() }], 'Avaliação', now)
    const r = await executarAgenda(deps, conv({ offers: perto }), ctx(), marcar(1), now)
    expect(deps.gravar).not.toHaveBeenCalled()
    expect(r.texto).toContain(TEXTO_VENCIDA)
  })
})

describe('remarcar', () => {
  const remarcar = (opcao: number | null, consulta: 'C1' | 'C2' = 'C1'): D => ({ acao: 'remarcar', resposta: 'Vamos lá.', consulta, opcao })

  it('remarcar sem opção guarda replace_appointment_id e busca', async () => {
    const deps = makeDeps()
    const r = await executarAgenda(deps, conv(), ctx(), remarcar(null), now)
    const estado = (deps.salvarEstado.mock.calls[0] as unknown as [string, string, { offers: Oferta[]; booking_draft: unknown }])[2]
    expect(estado.booking_draft).toEqual({ tipo: 'Retorno', replace_appointment_id: 'ap1' })
    expect(estado.offers[0].tipo).toBe('Retorno')
    expect(r.texto).toContain(TEXTO_FECHO)
  })

  it('procedimento fora da lista usa o primeiro tipo ativo', async () => {
    const deps = makeDeps()
    const c = { ...consultaC1, procedure: 'Canal' }
    await executarAgenda(deps, conv(), ctx({}, [{ alias: 'C1', consulta: c }]), remarcar(null), now)
    const estado = (deps.salvarEstado.mock.calls[0] as unknown as [string, string, { booking_draft: { tipo: string } }])[2]
    expect(estado.booking_draft.tipo).toBe('Avaliação')
  })

  it('remarcar com opção chama gravar com replaceId', async () => {
    const deps = makeDeps({ contarFuturasWhatsapp: vi.fn(async () => 5) })
    const r = await executarAgenda(deps, conv({ offers: ofertaBase }), ctx(), remarcar(1), now)
    expect(deps.gravar).toHaveBeenCalledWith(expect.objectContaining({ replaceId: 'ap1', start: '2026-11-10T11:30:00Z', procedure: 'Avaliação' }))
    expect(deps.contarFuturasWhatsapp).not.toHaveBeenCalled()
    expect(r).toEqual({
      texto: 'Pronto! Sua consulta foi remarcada para terça-feira, 10/11, às 8h30 com Dr. Carlos Mendes.',
      handoff: null, appointmentId: 'ap-novo', agentAction: 'remarcada',
    })
    expect(deps.salvarEstado).toHaveBeenCalledWith('k1', 'conv1', { offers: [], booking_draft: null, searches: [] })
  })

  it('remarcar consulta que mudou passa para a recepção', async () => {
    const deps = makeDeps({ gravar: vi.fn(async () => ({ ok: false as const, erro: 'CONSULTA_INVALIDA' as const })) })
    const r = await executarAgenda(deps, conv({ offers: ofertaBase }), ctx(), remarcar(1), now)
    expect(r.handoff).toBe('Consulta alterada pela clínica')
    expect(r.texto).toBe(TEXTO_PASSAGEM)
    expect(r.agentAction).toBeNull()
  })

  it('remarcar dentro da antecedência → recepção', async () => {
    const deps = makeDeps()
    const r = await executarAgenda(deps, conv({ offers: ofertaBase }), ctx({}, [{ alias: 'C1', consulta: consultaPerto }]), remarcar(1), now)
    expect(r.handoff).toBe('Remarcação em cima da hora')
    expect(deps.gravar).not.toHaveBeenCalled()
  })

  it('apelido inexistente → recepção', async () => {
    const deps = makeDeps()
    const r = await executarAgenda(deps, conv(), ctx(), remarcar(null, 'C2'), now)
    expect(r.handoff).toBe('Remarcação em cima da hora')
  })
})

describe('desmarcar', () => {
  const desmarcar = (consulta: 'C1' | 'C2' = 'C1'): D => ({ acao: 'desmarcar', resposta: 'Tudo bem.', consulta })

  it('desmarcar ok', async () => {
    const deps = makeDeps()
    const r = await executarAgenda(deps, conv(), ctx(), desmarcar(), now)
    expect(deps.desmarcar).toHaveBeenCalledWith('k1', 'pac1', 'ap1')
    expect(r).toEqual({
      texto: 'Consulta de 12/11 às 10h desmarcada. Se quiser marcar outra data, é só pedir.',
      handoff: null, appointmentId: 'ap1', agentAction: 'desmarcada',
    })
  })

  it('desmarcar dentro da antecedência → recepção', async () => {
    const deps = makeDeps()
    const r = await executarAgenda(deps, conv(), ctx({}, [{ alias: 'C1', consulta: consultaPerto }]), desmarcar(), now)
    expect(r.handoff).toBe('Cancelamento em cima da hora')
    expect(r.texto).toBe(TEXTO_PASSAGEM)
    expect(deps.desmarcar).not.toHaveBeenCalled()
  })

  it('consulta que mudou → recepção', async () => {
    const deps = makeDeps({ desmarcar: vi.fn(async () => false) })
    const r = await executarAgenda(deps, conv(), ctx(), desmarcar(), now)
    expect(r.handoff).toBe('Cancelamento em cima da hora')
    expect(r.agentAction).toBeNull()
  })
})
