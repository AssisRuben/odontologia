import { describe, it, expect } from 'vitest'
import { buildFunnel, type FunnelRow } from '@/lib/orcamentos/funil'

const f = { from: '2026-11-01', to: '2026-11-30' }
const row = (o: Partial<FunnelRow>): FunnelRow => ({
  id: 'x', status: 'sent', sent_at: '2026-11-10T10:00:00-03:00', decided_at: null, total: 1000,
  approved_total: 0, professional_id: 'p1', professional_name: 'Ana', lost_reason: null, ...o,
})

describe('buildFunnel', () => {
  it('período por sent_at, inclusivo, no fuso', () => {
    const r = buildFunnel([
      row({ id: 'a', sent_at: '2026-11-01T00:30:00-03:00' }),
      row({ id: 'b', sent_at: '2026-11-30T23:30:00-03:00' }),
      row({ id: 'c', sent_at: '2026-12-01T00:30:00-03:00' }),
      row({ id: 'd', sent_at: null }),
    ], f)
    expect(r.presented.count).toBe(2)
  })
  it('parcial soma approved_total; taxas', () => {
    const r = buildFunnel([
      row({ id: 'a', status: 'approved', total: 1000, approved_total: 400, decided_at: '2026-11-12T10:00:00-03:00' }),
      row({ id: 'b', status: 'sent', total: 1000 }),
    ], f)
    expect(r.presented).toEqual({ count: 2, cents: 200000 })
    expect(r.approved).toEqual({ count: 1, cents: 40000 })
    expect(r.rateCents).toBeCloseTo(0.2)
    expect(r.rateCount).toBeCloseTo(0.5)
  })
  it('completed conta como aprovado', () => {
    const r = buildFunnel([row({ status: 'completed', approved_total: 1000, decided_at: '2026-11-11T10:00:00-03:00' })], f)
    expect(r.approved.count).toBe(1)
  })
  it('Sem dentista', () => {
    const r = buildFunnel([row({ professional_id: null, professional_name: '' })], f)
    expect(r.byProfessional[0]).toMatchObject({ id: null, name: 'Sem dentista' })
  })
  it('tempo médio', () => {
    const r = buildFunnel([
      row({ id: 'a', status: 'approved', approved_total: 1000, sent_at: '2026-11-10T10:00:00-03:00', decided_at: '2026-11-12T10:00:00-03:00' }),
      row({ id: 'b', status: 'approved', approved_total: 1000, sent_at: '2026-11-10T10:00:00-03:00', decided_at: '2026-11-14T10:00:00-03:00' }),
    ], f)
    expect(r.avgDaysToApprove).toBe(3)
  })
  it('motivos ordenados por contagem', () => {
    const r = buildFunnel([
      row({ id: 'a', status: 'rejected', lost_reason: 'medo' }),
      row({ id: 'b', status: 'expired', lost_reason: 'preco' }),
      row({ id: 'c', status: 'rejected', lost_reason: 'preco' }),
      row({ id: 'd', status: 'sent', lost_reason: 'tempo' }),
    ], f)
    expect(r.lostReasons).toEqual([
      { code: 'preco', label: 'Achou caro', count: 2 },
      { code: 'medo', label: 'Medo ou ansiedade', count: 1 },
    ])
  })
  it('filtro por dentista', () => {
    const r = buildFunnel([row({ id: 'a' }), row({ id: 'b', professional_id: 'p2', professional_name: 'Bia' })], { ...f, professionalId: 'p2' })
    expect(r.presented.count).toBe(1)
    expect(r.byProfessional.map(p => p.name)).toEqual(['Bia'])
  })
  it('sem apresentados: taxas nulas', () => {
    const r = buildFunnel([], f)
    expect(r.rateCents).toBeNull()
    expect(r.rateCount).toBeNull()
    expect(r.avgDaysToApprove).toBeNull()
  })
  it('professionalId null filtra só sem dentista; undefined = todos', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', professional_id: null, professional_name: '' })]
    expect(buildFunnel(rows, { ...f, professionalId: null }).presented.count).toBe(1)
    expect(buildFunnel(rows, { ...f, professionalId: undefined }).presented.count).toBe(2)
    expect(buildFunnel(rows, { ...f, professionalId: 'p1' }).presented.count).toBe(1)
  })
})
