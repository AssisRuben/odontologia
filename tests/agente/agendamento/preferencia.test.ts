import { describe, it, expect } from 'vitest'
import { escolherOfertas, type Preferencia } from '@/lib/agente/agendamento/preferencia'
import { calcularHorarios, type Candidato } from '@/lib/agente/agendamento/horarios'
import { MAX_OFFERS } from '@/lib/agente/agendamento/limites'

const TZ = 'America/Sao_Paulo'
const pref = (p: Partial<Preferencia>): Preferencia => ({ dias_semana: null, periodo: null, a_partir_de: null, profissional: null, ...p })
// horário local SP = UTC-3
const c = (iso: string, nome = 'Dr. Carlos Mendes', id = 'p1'): Candidato => {
  const s = new Date(iso)
  return { professional_id: id, professional_name: nome, start: s.toISOString(), end: new Date(s.getTime() + 1800000).toISOString() }
}

describe('escolherOfertas', () => {
  it('sem preferência: cronológico, até MAX_OFFERS', () => {
    const cs = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16'].map((d) => c(`${d}T12:00:00Z`))
    const r = escolherOfertas(cs, null, TZ)
    expect(r.escolhidos).toHaveLength(MAX_OFFERS)
    expect(r.relaxou).toBe(false)
  })
  it('período tarde filtra 12:00–17:59', () => {
    const cs = [c('2026-11-09T14:59:00Z'), c('2026-11-09T15:00:00Z'), c('2026-11-09T20:59:00Z'), c('2026-11-09T21:00:00Z')]
    const r = escolherOfertas(cs, pref({ periodo: 'tarde' }), TZ)
    expect(r.escolhidos.map((x) => x.start)).toEqual(['2026-11-09T15:00:00.000Z', '2026-11-09T20:59:00.000Z'])
    expect(r.relaxou).toBe(false)
  })
  it('manhã e noite', () => {
    const cs = [c('2026-11-09T14:59:00Z'), c('2026-11-09T21:00:00Z')]
    expect(escolherOfertas(cs, pref({ periodo: 'manha' }), TZ).escolhidos).toHaveLength(1)
    expect(escolherOfertas(cs, pref({ periodo: 'noite' }), TZ).escolhidos[0].start).toBe('2026-11-09T21:00:00.000Z')
  })
  it('dias_semana [2] com só quarta livre relaxa', () => {
    const r = escolherOfertas([c('2026-11-11T12:00:00Z')], pref({ dias_semana: [2] }), TZ)
    expect(r.escolhidos).toHaveLength(1)
    expect(r.relaxou).toBe(true)
  })
  it('relaxa período antes dos dias', () => {
    const cs = [c('2026-11-10T12:00:00Z'), c('2026-11-11T12:00:00Z')] // ter 09:00, qua 09:00
    const r = escolherOfertas(cs, pref({ dias_semana: [2], periodo: 'tarde' }), TZ)
    expect(r.escolhidos.map((x) => x.start)).toEqual(['2026-11-10T12:00:00.000Z'])
    expect(r.relaxou).toBe(true)
  })
  it('a_partir_de', () => {
    const cs = [c('2026-11-09T12:00:00Z'), c('2026-11-12T12:00:00Z')]
    const r = escolherOfertas(cs, pref({ a_partir_de: '2026-11-10' }), TZ)
    expect(r.escolhidos).toHaveLength(1)
    expect(r.relaxou).toBe(false)
  })
  it('profissional casa sem acento/contém', () => {
    const cs = [c('2026-11-09T12:00:00Z', 'Dra. Ana', 'p2'), c('2026-11-09T12:30:00Z', 'Dr. Carlos Mendes')]
    expect(escolherOfertas(cs, pref({ profissional: 'carlos' }), TZ).escolhidos.map((x) => x.professional_id)).toEqual(['p1'])
    expect(escolherOfertas([c('2026-11-09T12:00:00Z', 'Dr. José')], pref({ profissional: 'jose' }), TZ).escolhidos).toHaveLength(1)
  })
  it('profissional inexistente: vazio sem relaxar', () => {
    const r = escolherOfertas([c('2026-11-09T12:00:00Z')], pref({ profissional: 'zzz' }), TZ)
    expect(r).toEqual({ escolhidos: [], relaxou: false })
  })
  it('no máximo 2 por dia', () => {
    const cs = [c('2026-11-09T11:00:00Z'), c('2026-11-09T11:30:00Z'), c('2026-11-09T12:00:00Z')]
    expect(escolherOfertas(cs, null, TZ).escolhidos).toHaveLength(2)
  })
  it('preferência de hoje depois do horário vai para a próxima semana', () => {
    const terca19 = new Date('2026-11-10T22:00:00Z') // terça 19:00 SP
    const cs = calcularHorarios({
      profissionais: [{ id: 'p1', nome: 'Dr. Carlos', workingHours: { '2': [['08:00', '18:00']] } }],
      ocupados: [],
      clinicHours: { '2': ['08:00', '18:00'] },
      regras: { antecedencia_h: 0, dias_a_frente: 10, intervalo_min: 30 },
      duracaoMin: 30,
      now: terca19,
      timezone: TZ,
    })
    const r = escolherOfertas(cs, pref({ dias_semana: [2] }), TZ)
    expect(r.escolhidos[0].start).toBe('2026-11-17T11:00:00.000Z')
    expect(r.relaxou).toBe(false)
  })
  it('vazio quando não há candidatos', () => {
    expect(escolherOfertas([], pref({ periodo: 'tarde' }), TZ)).toEqual({ escolhidos: [], relaxou: false })
  })
})
