import { describe, it, expect } from 'vitest'
import {
  TIPOS_PADRAO, REGRAS_PADRAO, normalizeTipos, normalizeRegras, normalizeWorkingHours,
  validateTipos, validateRegras, validateWorkingHours,
} from '@/lib/agente/agendamento/config'
import { normalizeAgentConfig, validateAgentConfig } from '@/lib/agente/config'

const T = { id: 'a', nome: 'Limpeza', duracao_min: 45, profissionais: null, ativo: true }

describe('tipos', () => {
  it('null vira padrão com ids estáveis', () => {
    expect(normalizeTipos(null)).toEqual(TIPOS_PADRAO)
    expect(TIPOS_PADRAO.map((t) => t.id)).toEqual(['avaliacao', 'retorno'])
    expect(TIPOS_PADRAO.map((t) => t.nome)).toEqual(['Avaliação', 'Retorno'])
  })
  it('duração 20 é inválida', () => {
    expect(validateTipos([{ ...T, duracao_min: 20 }])).toEqual({ ok: false, error: 'Tipo de consulta inválido' })
  })
  it('21 tipos', () => {
    const l = Array.from({ length: 21 }, (_, i) => ({ ...T, id: `t${i}` }))
    expect(validateTipos(l)).toEqual({ ok: false, error: 'Máximo de 20 tipos' })
  })
  it('id repetido ou vazio é inválido', () => {
    expect(validateTipos([T, T]).ok).toBe(false)
    expect(validateTipos([{ ...T, id: '' }]).ok).toBe(false)
    expect(validateTipos([{ ...T, id: 'x'.repeat(41) }]).ok).toBe(false)
  })
  it('ok, e normalize descarta item inválido', () => {
    expect(validateTipos([T])).toEqual({ ok: true, tipos: [T] })
    expect(normalizeTipos([T, { ...T, id: 'b', duracao_min: 7 }])).toEqual([T])
    expect(normalizeTipos([{ nome: '' }])).toEqual(TIPOS_PADRAO)
  })
  it('profissionais precisa ser lista de UUIDs ou null', () => {
    expect(validateTipos([{ ...T, profissionais: ['nao-uuid'] }]).ok).toBe(false)
    const id = '11111111-1111-4111-8111-111111111111'
    expect(validateTipos([{ ...T, profissionais: [id] }]).ok).toBe(true)
  })
})

describe('regras', () => {
  it('intervalo 45 → 30', () => {
    expect(normalizeRegras({ antecedencia_h: 2, dias_a_frente: 10, intervalo_min: 45 })).toEqual({ antecedencia_h: 2, dias_a_frente: 10, intervalo_min: 30 })
  })
  it('null → padrão; fora da faixa → padrão do campo', () => {
    expect(normalizeRegras(null)).toEqual(REGRAS_PADRAO)
    expect(normalizeRegras({ antecedencia_h: 200, dias_a_frente: 0, intervalo_min: 15 })).toEqual({ antecedencia_h: 24, dias_a_frente: 30, intervalo_min: 15 })
  })
  it('validate', () => {
    expect(validateRegras({ antecedencia_h: 0, dias_a_frente: 90, intervalo_min: 60 }).ok).toBe(true)
    expect(validateRegras({ antecedencia_h: 0, dias_a_frente: 91, intervalo_min: 60 })).toEqual({ ok: false, error: 'Regras de agendamento inválidas' })
    expect(validateRegras({ antecedencia_h: 0, dias_a_frente: 9, intervalo_min: 45 }).ok).toBe(false)
  })
})

describe('working_hours', () => {
  it('sobreposto descarta o dia', () => {
    expect(normalizeWorkingHours({ '1': [['08:00', '12:00'], ['11:00', '13:00']], '2': [['13:00', '18:00'], ['08:00', '12:00']] }))
      .toEqual({ '2': [['08:00', '12:00'], ['13:00', '18:00']] })
  })
  it('três períodos descarta', () => {
    expect(normalizeWorkingHours({ '1': [['08:00', '09:00'], ['10:00', '11:00'], ['12:00', '13:00']] })).toEqual({})
  })
  it('formato antigo vira {}', () => {
    expect(normalizeWorkingHours({ '1': ['08:00', '12:00'] })).toEqual({})
    expect(normalizeWorkingHours(null)).toEqual({})
  })
  it('validate', () => {
    expect(validateWorkingHours({ '1': [['08:00', '12:00']] })).toEqual({ ok: true, hours: { '1': [['08:00', '12:00']] } })
    expect(validateWorkingHours({ '1': [['12:00', '08:00']] })).toEqual({ ok: false, error: 'Horário de trabalho inválido' })
    expect(validateWorkingHours({ '9': [['08:00', '12:00']] }).ok).toBe(false)
  })
})

describe('AgentConfig com os campos novos', () => {
  it('objeto da 6a vira tipos e regras padrão', () => {
    const c = normalizeAgentConfig({ enabled: true, hours: {}, info: '' })
    expect(c.tipos).toEqual(TIPOS_PADRAO)
    expect(c.agendamento).toEqual(REGRAS_PADRAO)
  })
  it('validateAgentConfig valida tipos e regras', () => {
    expect(validateAgentConfig({ enabled: false, hours: {}, info: '', tipos: [{ ...T, duracao_min: 20 }] })).toEqual({ ok: false, error: 'Tipo de consulta inválido' })
    expect(validateAgentConfig({ enabled: false, hours: {}, info: '', agendamento: { antecedencia_h: 1, dias_a_frente: 0, intervalo_min: 30 } })).toEqual({ ok: false, error: 'Regras de agendamento inválidas' })
  })
})
