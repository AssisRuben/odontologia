import { describe, it, expect } from 'vitest'
import { resumoAgenda, maisFaltam, type ConsultaIn } from '@/lib/indicadores/agenda'
import type { AppointmentStatus } from '@/types'

const agora = new Date('2026-11-20T15:00:00Z')
let n = 0
function c(status: AppointmentStatus, start = '2026-11-05T13:00:00Z', prof = 'd1', pac = 'p1'): ConsultaIn {
  return { id: `c${n++}`, patient_id: pac, professional_id: prof, start_time: start, status }
}
function muitas(status: AppointmentStatus, k: number, prof = 'd1') {
  return Array.from({ length: k }, () => c(status, undefined, prof))
}

describe('resumoAgenda', () => {
  it('conta atendidas, faltas, canceladas e taxas', () => {
    const cs = [...muitas('completed', 7), ...muitas('in_progress', 2), ...muitas('no_show', 1), ...muitas('cancelled', 2)]
    const r = resumoAgenda(cs, '2026-11', agora, null)
    expect(r).toMatchObject({ total: 12, atendidas: 9, faltas: 1, canceladas: 2, semDesfecho: 0 })
    expect(r.comparecimento).toBeCloseTo(0.9)
    expect(r.taxaFaltas).toBeCloseTo(0.1)
    expect(r.taxaCancelamento).toBeCloseTo(2 / 12)
  })
  it('sem consultas, taxas nulas', () => {
    const r = resumoAgenda([], '2026-11', agora, null)
    expect(r).toMatchObject({ total: 0, comparecimento: null, taxaFaltas: null, taxaCancelamento: null, porDentista: [] })
  })
  it('mês pela hora de São Paulo', () => {
    const cs = [c('completed', '2026-11-01T01:00:00Z')]
    expect(resumoAgenda(cs, '2026-10', agora, null).total).toBe(1)
    expect(resumoAgenda(cs, '2026-11', agora, null).total).toBe(0)
  })
  it('consulta futura no mês corrente não conta', () => {
    const hoje = new Date('2026-11-08T15:00:00Z')
    const cs = [c('scheduled', '2026-11-08T20:00:00Z'), c('scheduled', '2026-11-08T12:00:00Z')]
    const r = resumoAgenda(cs, '2026-11', hoje, null)
    expect(r.total).toBe(1)
    expect(r.semDesfecho).toBe(1)
  })
  it('filtro de dentista e porDentista', () => {
    const cs = [...muitas('completed', 3, 'd2'), ...muitas('no_show', 1, 'd2'), ...muitas('completed', 2, 'd1')]
    const todos = resumoAgenda(cs, '2026-11', agora, null)
    expect(todos.porDentista.map((d) => d.professional_id)).toEqual(['d1', 'd2'])
    expect(todos.porDentista[1]).toMatchObject({ atendidas: 3, faltas: 1, total: 4 })
    const so = resumoAgenda(cs, '2026-11', agora, 'd1')
    expect(so.total).toBe(2)
    expect(so.porDentista).toHaveLength(1)
  })
})

describe('maisFaltam', () => {
  const meses = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']
  const f = (pac: string, dia: string, prof = 'd1') => c('no_show', `2026-11-${dia}T13:00:00Z`, prof, pac)
  it('2+ faltas, ordem por faltas', () => {
    const cs = [f('a', '01'), f('b', '02'), f('b', '03'), f('c', '04'), f('c', '05'), f('c', '06')]
    const r = maisFaltam(cs, meses, agora, null)
    expect(r.map((x) => [x.patient_id, x.faltas])).toEqual([['c', 3], ['b', 2]])
    expect(r[0].ultima).toBe('2026-11-06')
  })
  it('empate fica estável por patient_id (o desempate por nome é do painel)', () => {
    const cs = [f('b', '03'), f('b', '09'), f('a', '01'), f('a', '02')]
    expect(maisFaltam(cs, meses, agora, null).map((x) => x.patient_id)).toEqual(['a', 'b'])
  })
  it('falta fora da janela não conta', () => {
    const cs = [f('a', '01'), c('no_show', '2026-03-01T13:00:00Z', 'd1', 'a')]
    expect(maisFaltam(cs, meses, agora, null)).toEqual([])
  })
  it('filtro de dentista; devolve todos os candidatos (o corte em 10 é do painel)', () => {
    const cs = [f('a', '01', 'd2'), f('a', '02', 'd2')]
    expect(maisFaltam(cs, meses, agora, 'd1')).toEqual([])
    const muitos = Array.from({ length: 12 }, (_, i) => [f(`p${i}`, '01'), f(`p${i}`, '02')]).flat()
    expect(maisFaltam(muitos, meses, agora, null)).toHaveLength(12)
  })
  it('ignora faltas futuras', () => {
    const cs = [c('no_show', '2026-11-25T13:00:00Z', 'd1', 'a'), c('no_show', '2026-11-26T13:00:00Z', 'd1', 'a')]
    expect(maisFaltam(cs, meses, agora, null)).toEqual([])
  })
})
