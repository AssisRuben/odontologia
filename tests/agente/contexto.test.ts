import { describe, it, expect } from 'vitest'
import { TIPOS_PADRAO, REGRAS_PADRAO } from '@/lib/agente/agendamento/config'
import { buildAgentContext, firstName, historyBody, historyRole, type AgentContextInput, type HistoryItem } from '@/lib/agente/contexto'

const base = (over: Partial<AgentContextInput> = {}): AgentContextInput => ({
  clinic: {
    name: 'Sorriso', address: 'Rua A, 1', phone: '1133334444', insurances: ['Amil', 'Bradesco'],
    config: { enabled: true, hours: { '1': ['08:00', '18:00'] }, info: 'Limpeza R$ 100', tipos: TIPOS_PADRAO, agendamento: REGRAS_PADRAO },
    timezone: 'America/Sao_Paulo',
  },
  contact: { kind: 'patient', firstName: 'Ana' },
  nextAppointments: [],
  history: [],
  now: new Date('2026-11-06T17:30:00Z'),
  ...over,
})

describe('buildAgentContext', () => {
  it('formato básico', () => {
    const t = buildAgentContext(base())
    expect(t).toContain('Clínica: Sorriso · Endereço: Rua A, 1 · Telefone: 1133334444')
    expect(t).toContain('Convênios aceitos: Amil, Bradesco')
    expect(t).toContain('Horário: Seg 08:00–18:00; Ter fechado')
    expect(t).toContain('Data e hora agora: sexta-feira, 06/11/2026 14:30')
    expect(t).toContain('Informações da clínica:\nLimpeza R$ 100')
    expect(t).toContain('Contato: paciente Ana')
    expect(t).toContain('Próximas consultas: nenhuma')
  })
  it('valores ausentes', () => {
    const b = base()
    const t = buildAgentContext(base({
      clinic: { ...b.clinic, address: null, phone: null, insurances: [], config: { ...b.clinic.config, info: '' } },
      contact: { kind: 'new', name: null },
    }))
    expect(t).toContain('Endereço: não informado · Telefone: não informado')
    expect(t).toContain('Convênios aceitos: nenhum cadastrado')
    expect(t).toContain('Informações da clínica:\n(nenhuma)')
    expect(t).toContain('Contato: contato novo (nome: não informado)')
  })
  it('contato novo com nome', () => {
    expect(buildAgentContext(base({ contact: { kind: 'new', name: 'Bia' } }))).toContain('contato novo (nome: Bia)')
  })
  it('consultas: até 3, com e sem profissional', () => {
    const appts = [
      { start: '2026-11-10T17:00:00Z', professional: 'Dr. Lima' },
      { start: '2026-11-11T12:00:00Z', professional: null },
      { start: '2026-11-12T12:00:00Z', professional: 'Dra. X' },
      { start: '2026-11-13T12:00:00Z', professional: 'Dra. Y' },
      { start: '2026-11-14T12:00:00Z', professional: 'Dra. Z' },
    ]
    const t = buildAgentContext(base({ nextAppointments: appts }))
    expect(t).toContain('10/11 14:00 com Dr. Lima')
    expect(t).toContain('11/11 09:00;')
    expect(t).toContain('12/11 09:00 com Dra. X')
    expect(t).not.toContain('13/11')
  })
  it('histórico: últimas 20 em ordem com rótulos', () => {
    const roles: HistoryItem['role'][] = ['paciente', 'assistente', 'equipe', 'automatica']
    const history: HistoryItem[] = Array.from({ length: 25 }, (_, i) => ({ role: roles[i % 4], body: `msg${i}` }))
    const t = buildAgentContext(base({ history }))
    expect(t).not.toContain('msg4\n')
    expect(t).toContain('[assistente] msg5')
    expect(t.indexOf('msg5')).toBeLessThan(t.indexOf('msg24'))
    expect(t).toContain('[paciente] msg24')
    expect(t).toContain('[equipe] msg6')
    expect(t).toContain('[automática] msg7')
    expect((t.match(/^\[(paciente|assistente|equipe|automática)\]/gm) ?? []).length).toBe(20)
  })
  it('não vaza dados proibidos', () => {
    const input = { ...base(), cpf: '12345678900', email: 'a@b.c', notes: 'segredo' } as AgentContextInput
    const t = buildAgentContext(input)
    for (const s of ['12345678900', 'a@b.c', 'segredo']) expect(t).not.toContain(s)
  })
})

describe('firstName', () => {
  it('primeiro nome', () => {
    expect(firstName('  Maria da Silva ')).toBe('Maria')
    expect(firstName('')).toBe('')
  })
})

describe('historyRole', () => {
  it('mapeia', () => {
    expect(historyRole({ direction: 'in', type: 'incoming' })).toBe('paciente')
    expect(historyRole({ direction: 'out', type: 'agent' })).toBe('assistente')
    expect(historyRole({ direction: 'out', type: 'human' })).toBe('equipe')
    expect(historyRole({ direction: 'out', type: 'manual' })).toBe('equipe')
    expect(historyRole({ direction: 'out', type: 'reminder' })).toBe('automatica')
  })
})

describe('historyBody', () => {
  it('mascara cobranças e orçamentos; mantém o resto', () => {
    const masked = '[mensagem automática de cobrança ou orçamento]'
    for (const t of ['charge', 'payment_due', 'budget', 'budget_reminder']) expect(historyBody(t, 'R$ 100')).toBe(masked)
    for (const t of ['reminder', 'confirmation', 'incoming', 'agent', 'human', 'manual']) expect(historyBody(t, 'texto')).toBe('texto')
  })
})
