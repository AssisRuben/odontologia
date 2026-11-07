import { describe, it, expect } from 'vitest'
import { TIPOS_PADRAO, REGRAS_PADRAO } from '@/lib/agente/agendamento/config'
import { normalizeAgentConfig, validateAgentConfig, formatHours, AGENT_INFO_MAX, needsPrerequisites } from '@/lib/agente/config'

describe('normalizeAgentConfig', () => {
  it('null vira padrão', () => {
    expect(normalizeAgentConfig(null)).toEqual({ enabled: false, hours: {}, info: '', tipos: TIPOS_PADRAO, agendamento: REGRAS_PADRAO })
  })
  it('descarta dia com abre >= fecha e dia inexistente', () => {
    const c = normalizeAgentConfig({ enabled: true, hours: { '1': ['18:00', '08:00'], '9': ['08:00', '18:00'], '2': ['08:00', '12:00'] }, info: '' })
    expect(c.hours).toEqual({ '2': ['08:00', '12:00'] })
    expect(c.enabled).toBe(true)
  })
  it('corta info em 4000', () => {
    expect(normalizeAgentConfig({ info: 'a'.repeat(5000) }).info).toHaveLength(AGENT_INFO_MAX)
    expect(AGENT_INFO_MAX).toBe(4000)
  })
})

describe('validateAgentConfig', () => {
  it('horário inválido', () => {
    expect(validateAgentConfig({ enabled: true, hours: { '1': ['25:00', '26:00'] }, info: '' })).toEqual({ ok: false, error: 'Horário inválido' })
  })
  it('texto longo demais', () => {
    expect(validateAgentConfig({ enabled: true, hours: {}, info: 'a'.repeat(4001) })).toEqual({ ok: false, error: 'Texto longo demais (máximo 4.000 caracteres)' })
  })
  it('ok', () => {
    const r = validateAgentConfig({ enabled: true, hours: { '1': ['08:00', '18:00'] }, info: ' oi ' })
    expect(r).toEqual({ ok: true, config: { enabled: true, hours: { '1': ['08:00', '18:00'] }, info: 'oi', tipos: TIPOS_PADRAO, agendamento: REGRAS_PADRAO } })
  })
})

describe('formatHours', () => {
  it('Seg a Dom', () => {
    const s = formatHours({ '1': ['08:00', '18:00'] })
    expect(s.startsWith('Seg 08:00–18:00; Ter fechado')).toBe(true)
    expect(s.endsWith('Dom fechado')).toBe(true)
  })
})

describe('needsPrerequisites', () => {
  const off = normalizeAgentConfig({ enabled: false })
  const on = normalizeAgentConfig({ enabled: true })
  it('só ao ligar (desligado → ligado)', () => {
    expect(needsPrerequisites(off, on)).toBe(true)
    expect(needsPrerequisites(on, { ...on, info: 'novo texto' })).toBe(false)
    expect(needsPrerequisites(on, off)).toBe(false)
    expect(needsPrerequisites(off, off)).toBe(false)
  })
})
