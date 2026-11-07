import { describe, it, expect } from 'vitest'
import { normalizeAgentConfig } from '@/lib/agente/config'
import {
  prepararConfig, tiposDaClinica, validarAgenda, ofertasParaResposta,
} from '@/lib/agente/agendamento/rotas'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const T = { id: 'a', nome: 'Limpeza', duracao_min: 45, profissionais: [P1], ativo: true }
const atual = normalizeAgentConfig({
  enabled: false, hours: { '1': ['08:00', '12:00'] }, info: 'x',
  tipos: [T], agendamento: { antecedencia_h: 48, dias_a_frente: 10, intervalo_min: 60 },
})

describe('prepararConfig', () => {
  it('corpo sem tipos/agendamento mantém os salvos', () => {
    const r = prepararConfig(atual, { enabled: true, hours: {}, info: 'y' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.config.tipos).toEqual([T])
      expect(r.config.agendamento).toEqual(atual.agendamento)
      expect(r.config.enabled).toBe(true)
      expect(r.config.info).toBe('y')
    }
  })
  it('profissionais [] vira null', () => {
    const r = prepararConfig(atual, { ...atual, tipos: [{ ...T, profissionais: [] }] })
    expect(r.ok && r.config.tipos[0].profissionais).toBe(null)
  })
  it('tipo inválido dá 422', () => {
    expect(prepararConfig(atual, { ...atual, tipos: [{ ...T, duracao_min: 20 }] }).ok).toBe(false)
  })
  it('corpo não objeto é inválido', () => {
    expect(prepararConfig(atual, null).ok).toBe(false)
  })
})

describe('tiposDaClinica', () => {
  it('profissional de outra clínica é inválido', () => {
    expect(tiposDaClinica([T], new Set([P2]))).toEqual({ ok: false, error: 'Tipo de consulta inválido' })
  })
  it('ok quando todos são da clínica ou null', () => {
    expect(tiposDaClinica([T, { ...T, id: 'b', profissionais: null }], new Set([P1])).ok).toBe(true)
  })
})

describe('validarAgenda', () => {
  it('ok', () => {
    expect(validarAgenda({ whatsapp_booking: true, working_hours: { '1': [['08:00', '12:00']] } })).toEqual({
      ok: true, whatsapp_booking: true, hours: { '1': [['08:00', '12:00']] },
    })
  })
  it('horário inválido', () => {
    expect(validarAgenda({ whatsapp_booking: true, working_hours: { '1': [['12:00', '08:00']] } }))
      .toEqual({ ok: false, error: 'Horário de trabalho inválido' })
  })
  it('whatsapp_booking não booleano', () => {
    expect(validarAgenda({ whatsapp_booking: 'sim', working_hours: {} }).ok).toBe(false)
  })
})

describe('ofertasParaResposta', () => {
  it('monta n e texto com fuso da clínica', () => {
    const o = { n: 1, tipo: 'Avaliação', expires_at: '2026-11-10T00:00:00Z', start: '2026-11-11T11:30:00Z', end: '2026-11-11T12:00:00Z', professional_id: P1, professional_name: 'Dr. Carlos' }
    expect(ofertasParaResposta([o] as never, 'America/Sao_Paulo')).toEqual([{ n: 1, texto: '1) qua 11/11 às 8h30 com Dr. Carlos' }])
  })
  it('vazio vira null', () => {
    expect(ofertasParaResposta([], 'America/Sao_Paulo')).toBe(null)
    expect(ofertasParaResposta(undefined, 'America/Sao_Paulo')).toBe(null)
  })
})
