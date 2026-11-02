import { describe, it, expect } from 'vitest'
import { DEFAULT_MESSAGING_CONFIG, normalizeMessagingConfig } from '@/lib/messaging/config'

describe('normalizeMessagingConfig', () => {
  it('null/vazio/não-objeto: padrões', () => {
    expect(normalizeMessagingConfig(null)).toEqual(DEFAULT_MESSAGING_CONFIG)
    expect(normalizeMessagingConfig({})).toEqual(DEFAULT_MESSAGING_CONFIG)
    expect(normalizeMessagingConfig('x')).toEqual(DEFAULT_MESSAGING_CONFIG)
    expect(DEFAULT_MESSAGING_CONFIG).toEqual({
      window_start: '08:00',
      window_end: '20:00',
      daily_limit: 300,
      timezone: 'America/Sao_Paulo',
    })
  })

  it('config válida é mantida', () => {
    const cfg = { window_start: '07:30', window_end: '21:00', daily_limit: 50, timezone: 'America/Manaus' }
    expect(normalizeMessagingConfig(cfg)).toEqual(cfg)
  })

  it('campos parciais completam com padrões', () => {
    expect(normalizeMessagingConfig({ daily_limit: 10 })).toEqual({ ...DEFAULT_MESSAGING_CONFIG, daily_limit: 10 })
    expect(normalizeMessagingConfig({ window_start: '09:00' })).toEqual({ ...DEFAULT_MESSAGING_CONFIG, window_start: '09:00' })
  })

  it('horário inválido ou início >= fim: janela padrão', () => {
    expect(normalizeMessagingConfig({ window_start: '8h', window_end: '18:00' })).toMatchObject({
      window_start: '08:00',
      window_end: '18:00',
    })
    expect(normalizeMessagingConfig({ window_start: '25:00', window_end: '26:00' })).toMatchObject({
      window_start: '08:00',
      window_end: '20:00',
    })
    expect(normalizeMessagingConfig({ window_start: '20:00', window_end: '08:00' })).toMatchObject({
      window_start: '08:00',
      window_end: '20:00',
    })
    expect(normalizeMessagingConfig({ window_start: '10:00', window_end: '10:00' })).toMatchObject({
      window_start: '08:00',
      window_end: '20:00',
    })
  })

  it('daily_limit: inteiro entre 1 e 1000', () => {
    expect(normalizeMessagingConfig({ daily_limit: 0 }).daily_limit).toBe(1)
    expect(normalizeMessagingConfig({ daily_limit: -5 }).daily_limit).toBe(1)
    expect(normalizeMessagingConfig({ daily_limit: 5000 }).daily_limit).toBe(1000)
    expect(normalizeMessagingConfig({ daily_limit: 12.6 }).daily_limit).toBe(13)
    expect(normalizeMessagingConfig({ daily_limit: '40' }).daily_limit).toBe(40)
    expect(normalizeMessagingConfig({ daily_limit: 'abc' }).daily_limit).toBe(300)
    expect(normalizeMessagingConfig({ daily_limit: null }).daily_limit).toBe(300)
  })

  it('fuso inválido: America/Sao_Paulo', () => {
    expect(normalizeMessagingConfig({ timezone: 'Marte/Base' }).timezone).toBe('America/Sao_Paulo')
    expect(normalizeMessagingConfig({ timezone: '' }).timezone).toBe('America/Sao_Paulo')
    expect(normalizeMessagingConfig({ timezone: 3 }).timezone).toBe('America/Sao_Paulo')
  })
})
