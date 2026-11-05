import { describe, it, expect } from 'vitest'
import { parseFunnelQuery, parseDecision } from '@/lib/orcamentos/rotas'

describe('parseFunnelQuery', () => {
  it('aceita período válido e dentista', () => {
    expect(parseFunnelQuery(new URLSearchParams('de=2026-10-01&ate=2026-10-31'))).toEqual({
      ok: true, from: '2026-10-01', to: '2026-10-31', professionalId: undefined,
    })
    const r = parseFunnelQuery(new URLSearchParams('de=2026-10-01&ate=2026-10-01&dentista=none'))
    expect(r).toMatchObject({ ok: true, professionalId: null })
    expect(parseFunnelQuery(new URLSearchParams('de=2026-10-01&ate=2026-10-02&dentista=abc'))).toMatchObject({ professionalId: 'abc' })
  })
  it.each(['', 'de=2026-10-01', 'de=2026-02-30&ate=2026-03-01', 'de=x&ate=y', 'de=2026-10-05&ate=2026-10-01'])(
    'rejeita %s', (q) => {
      expect(parseFunnelQuery(new URLSearchParams(q))).toEqual({ ok: false, status: 422, error: 'Período inválido' })
    })
})

describe('parseDecision', () => {
  it('rejeita ação desconhecida', () => {
    expect(parseDecision({ action: 'x' })).toMatchObject({ ok: false, status: 422 })
    expect(parseDecision(null)).toMatchObject({ ok: false, status: 422 })
  })
  it('lose exige motivo válido', () => {
    expect(parseDecision({ action: 'lose' })).toEqual({ ok: false, status: 422, error: 'Escolha o motivo' })
    expect(parseDecision({ action: 'lose', reason: 'zzz' })).toMatchObject({ error: 'Escolha o motivo' })
    expect(parseDecision({ action: 'lose', reason: 'preco', note: '  oi  ' })).toEqual({
      ok: true, decision: { action: 'lose', reason: 'preco', note: 'oi' },
    })
    const long = parseDecision({ action: 'lose', reason: 'preco', note: 'a'.repeat(600) })
    expect(long.ok && long.decision.action === 'lose' && long.decision.note?.length).toBe(500)
  })
  it('approve exige itemIds', () => {
    expect(parseDecision({ action: 'approve', itemIds: [] })).toMatchObject({ ok: false, status: 422 })
    expect(parseDecision({ action: 'approve', itemIds: ['a'] })).toEqual({ ok: true, decision: { action: 'approve', itemIds: ['a'] } })
  })
  it('reopen', () => {
    expect(parseDecision({ action: 'reopen' })).toEqual({ ok: true, decision: { action: 'reopen' } })
  })
})
