import { describe, it, expect } from 'vitest'
import { resumoFinanceiro, producao, pacientesNovos } from '@/lib/indicadores/financeiro'

const r = (patient_id: string, amount: number, payment_method: string | null, paid_at = '2026-11-10') => ({
  patient_id, amount, payment_method, paid_at,
})

describe('resumoFinanceiro', () => {
  it('ticket conta paciente uma vez', () => {
    const recs = [r('A', 100, 'pix'), r('A', 50, 'pix'), r('B', 150, 'cartao'), r('A', 200, 'convenio')]
    const s = resumoFinanceiro(recs, '2026-11')
    expect(s.recebidoCentavos).toBe(50000)
    expect(s.pacientes).toBe(2)
    expect(s.ticketCentavos).toBe(25000)
    expect(s.particularCentavos).toBe(30000)
    expect(s.convenioCentavos).toBe(20000)
    expect(s.ticketParticularCentavos).toBe(15000)
    expect(s.ticketConvenioCentavos).toBe(20000)
  })
  it('exemplo do brief: sem convênio', () => {
    const s = resumoFinanceiro([r('A', 100, 'pix'), r('A', 50, 'pix'), r('B', 150, 'pix')], '2026-11')
    expect(s).toMatchObject({ recebidoCentavos: 30000, pacientes: 2, ticketCentavos: 15000, ticketConvenioCentavos: null })
  })
  it('mês sem recebimentos', () => {
    const s = resumoFinanceiro([r('A', 100, null, '2026-10-10')], '2026-11')
    expect(s).toEqual({
      recebidoCentavos: 0, particularCentavos: 0, convenioCentavos: 0, pacientes: 0,
      ticketCentavos: null, ticketParticularCentavos: null, ticketConvenioCentavos: null,
    })
  })
  it('arredonda centavos', () => {
    expect(resumoFinanceiro([r('A', 10.01, null)], '2026-11').recebidoCentavos).toBe(1001)
  })
})

describe('producao', () => {
  const ts = [
    { professional_id: 'd1', value: 100, completed_at: '2026-11-03T13:00:00Z' },
    { professional_id: 'd2', value: 50.5, completed_at: '2026-11-04T13:00:00Z' },
    { professional_id: null, value: 20, completed_at: '2026-11-05T13:00:00Z' },
    { professional_id: 'd1', value: 999, completed_at: '2026-10-05T13:00:00Z' },
  ]
  it('total e por dentista', () => {
    const p = producao(ts, '2026-11', null)
    expect(p.totalCentavos).toBe(17050)
    expect(p.porDentista).toEqual(
      expect.arrayContaining([
        { professional_id: 'd1', totalCentavos: 10000 },
        { professional_id: 'd2', totalCentavos: 5050 },
        { professional_id: null, totalCentavos: 2000 },
      ]),
    )
    expect(p.porDentista).toHaveLength(3)
  })
  it('completed_at é data pura: 2026-11-01 conta em 2026-11', () => {
    const p = producao([{ professional_id: 'd1', value: 10, completed_at: '2026-11-01' }], '2026-11', null)
    expect(p.totalCentavos).toBe(1000)
    expect(producao([{ professional_id: 'd1', value: 10, completed_at: '2026-11-01' }], '2026-10', null).totalCentavos).toBe(0)
  })
  it('paid_at 2026-11-01 conta em 2026-11', () => {
    expect(resumoFinanceiro([r('A', 10, null, '2026-11-01')], '2026-11').recebidoCentavos).toBe(1000)
  })
  it('filtro por dentista', () => {
    const p = producao(ts, '2026-11', 'd1')
    expect(p.totalCentavos).toBe(10000)
    expect(p.porDentista).toEqual([{ professional_id: 'd1', totalCentavos: 10000 }])
  })
})

describe('pacientesNovos', () => {
  it('conta no mês e via whatsapp', () => {
    const ps = [
      { id: '1', created_at: '2026-11-02T13:00:00Z', source: 'whatsapp' },
      { id: '2', created_at: '2026-11-03T13:00:00Z', source: null },
      { id: '3', created_at: '2026-11-04T13:00:00Z', source: 'indicacao' },
      { id: '4', created_at: '2026-10-04T13:00:00Z', source: 'whatsapp' },
    ]
    expect(pacientesNovos(ps, '2026-11')).toEqual({ total: 3, whatsapp: 1 })
  })
})
