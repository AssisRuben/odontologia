import { describe, it, expect } from 'vitest'
import { montarHistorico, type ConsultaHist, type EvolucaoHist } from '@/lib/pacientes/historicoConsultas'
import type { AppointmentStatus } from '@/types'

// Horários sem fuso: valem como hora local, como a agenda mostra.
const c = (id: string, start: string, status: AppointmentStatus = 'completed', prof: string | null = 'Ana'): ConsultaHist => ({
  id,
  start_time: start,
  end_time: start,
  status,
  procedure: null,
  professional: prof ? { name: prof, color: null } : null,
})
const e = (id: string, date: string, appointment_id: string | null = null): EvolucaoHist => ({ id, date, appointment_id })

const agora = new Date('2026-11-25T12:00:00')
const ids = (l: { id: string }[] | undefined) => l?.map((x) => x.id)

describe('montarHistorico', () => {
  it('separa próximas e histórico', () => {
    const r = montarHistorico([
      c('a', '2026-12-02T10:00:00', 'scheduled'),
      c('b', '2026-11-30T10:00:00', 'confirmed'),
      c('x', '2026-12-05T10:00:00', 'cancelled'),
      c('d', '2026-11-18T10:00:00', 'completed'),
      c('v', '2026-10-01T10:00:00', 'scheduled'), // passada, nunca atualizada
    ], [], agora)
    expect(ids(r.proximas)).toEqual(['b', 'a'])
    expect(r.anos.flatMap((a) => ids(a.consultas))).toEqual(['x', 'd', 'v'])
  })

  it('agrupa por ano, do mais recente', () => {
    const r = montarHistorico([
      c('2026-03-10', '2026-03-10T10:00:00'),
      c('2025-08-01', '2025-08-01T10:00:00'),
      c('2026-11-18', '2026-11-18T10:00:00'),
      c('2024-01-05', '2024-01-05T10:00:00'),
    ], [], agora)
    expect(r.anos.map((a) => a.ano)).toEqual([2026, 2025, 2024])
    expect(ids(r.anos[0].consultas)).toEqual(['2026-11-18', '2026-03-10'])
  })

  it('ano pelo horário local', () => {
    const r = montarHistorico([c('r', '2025-12-31T23:30:00')], [], agora)
    expect(r.anos).toEqual([{ ano: 2025, consultas: [expect.objectContaining({ id: 'r' })] }])
  })

  it('resume realizadas, faltas, canceladas e dentistas', () => {
    const r = montarHistorico([
      c('1', '2024-03-04T10:00:00', 'completed', 'Paulo'),
      c('2', '2025-05-04T10:00:00', 'completed', 'Ana'),
      c('3', '2026-02-04T10:00:00', 'completed', 'Ana'),
      c('4', '2025-06-04T10:00:00', 'no_show'),
      c('5', '2025-07-04T10:00:00', 'no_show'),
      c('6', '2025-08-04T10:00:00', 'cancelled', 'Bia'),
    ], [], agora)
    expect(r.resumo).toEqual({ realizadas: 3, primeira: '2024-03-04T10:00:00', faltas: 2, canceladas: 1, dentistas: ['Ana', 'Paulo'] })
  })

  it('sem consultas', () => {
    expect(montarHistorico([], [], agora)).toEqual({
      resumo: { realizadas: 0, primeira: null, faltas: 0, canceladas: 0, dentistas: [] },
      proximas: [],
      anos: [],
      evolucoesDa: {},
    })
  })

  it('liga evolução pela consulta gravada', () => {
    const r = montarHistorico([c('d', '2026-11-18T10:00:00')], [e('e1', '2026-11-18', 'd')], agora)
    expect(ids(r.evolucoesDa.d)).toEqual(['e1'])
  })

  it('sem ligação, vale o mesmo dia e a primeira consulta do dia', () => {
    const r = montarHistorico(
      [c('t', '2026-11-10T15:00:00'), c('m', '2026-11-10T09:00:00')],
      [e('e2', '2026-11-10')],
      agora,
    )
    expect(ids(r.evolucoesDa.m)).toEqual(['e2'])
    expect(r.evolucoesDa.t).toBeUndefined()
  })

  it('mesmo dia não rouba consulta que já tem evolução ligada', () => {
    const r = montarHistorico(
      [c('m', '2026-11-10T09:00:00'), c('t', '2026-11-10T15:00:00')],
      [e('e1', '2026-11-10', 'm'), e('e2', '2026-11-10')],
      agora,
    )
    expect(ids(r.evolucoesDa.m)).toEqual(['e1'])
    expect(ids(r.evolucoesDa.t)).toEqual(['e2'])
  })

  it('ligação para consulta fora da lista cai na regra do dia', () => {
    const r = montarHistorico([c('d', '2026-11-18T10:00:00')], [e('e3', '2026-11-18', 'sumiu')], agora)
    expect(ids(r.evolucoesDa.d)).toEqual(['e3'])
  })

  it('evolução sem consulta no dia fica fora', () => {
    const r = montarHistorico([c('d', '2026-11-18T10:00:00')], [e('e4', '2020-01-01')], agora)
    expect(r.evolucoesDa).toEqual({})
  })
})
