import { describe, it, expect } from 'vitest'
import { alocarParticular, type RecebimentoIn, type TratamentoIn } from '@/lib/comissoes/alocacao'

let n = 0
const rec = (o: Partial<RecebimentoIn> & { amount: number }): RecebimentoIn => ({
  id: `r${++n}`, patient_id: 'p1', net_amount: null, payment_method: 'pix',
  paid_at: '2026-10-01', created_at: `2026-10-01T10:00:0${n % 10}Z`, ...o,
})
const trat = (o: Partial<TratamentoIn> & { value: number }): TratamentoIn => ({
  id: `t${++n}`, patient_id: 'p1', professional_id: 'ana', procedure: 'Proc',
  completed_at: '2026-09-01', created_at: `2026-09-01T10:00:0${n % 10}Z`, em_guia: false, ...o,
})
const resumo = (p: ReturnType<typeof alocarParticular>) => p.map(x => [x.treatment_id, x.professional_id, x.baseCentavos])

describe('alocarParticular', () => {
  it('um recebimento quitando dois tratamentos de dentistas diferentes', () => {
    const r = alocarParticular(
      [rec({ amount: 1000 })],
      [trat({ id: 'A', value: 600 }), trat({ id: 'B', value: 600, professional_id: 'bruno', completed_at: '2026-09-02' })],
    )
    expect(resumo(r)).toEqual([['A', 'ana', 60000], ['B', 'bruno', 40000]])
  })
  it('pagamento parcial', () => {
    const r = alocarParticular([rec({ amount: 250 })], [trat({ id: 'A', value: 600 })])
    expect(resumo(r)).toEqual([['A', 'ana', 25000]])
  })
  it('dois recebimentos quitando um tratamento', () => {
    const r = alocarParticular(
      [rec({ amount: 200, paid_at: '2026-10-01' }), rec({ amount: 400, paid_at: '2026-10-10' })],
      [trat({ id: 'A', value: 600 })],
    )
    expect(r.map(x => [x.baseCentavos, x.data])).toEqual([[20000, '2026-10-01'], [40000, '2026-10-10']])
  })
  it('adiantamento vira comissão na conclusão', () => {
    const r = alocarParticular(
      [rec({ amount: 500, paid_at: '2026-10-05' })],
      [trat({ id: 'A', value: 500, completed_at: '2026-12-02' })],
    )
    expect(r).toHaveLength(1)
    expect(r[0].data).toBe('2026-12-02')
  })
  it('crédito sobrando não gera parte', () => {
    const r = alocarParticular([rec({ amount: 1000 })], [trat({ id: 'A', value: 300 })])
    expect(resumo(r)).toEqual([['A', 'ana', 30000]])
  })
  it('recebimento convenio não quita tratamento particular', () => {
    const r = alocarParticular([rec({ amount: 500, payment_method: 'convenio' })], [trat({ value: 500 })])
    expect(r).toEqual([])
  })
  it('tratamento em guia, sem valor ou sem conclusão é ignorado', () => {
    const r = alocarParticular(
      [rec({ amount: 1000 })],
      [trat({ id: 'G', value: 500, em_guia: true }), trat({ id: 'Z', value: 0 }), trat({ id: 'N', value: 500, completed_at: null }), trat({ id: 'A', value: 100 })],
    )
    expect(resumo(r)).toEqual([['A', 'ana', 10000]])
  })
  it('tratamento sem dentista consome mas não comissiona', () => {
    const r = alocarParticular(
      [rec({ amount: 500 })],
      [trat({ id: 'S', value: 300, professional_id: null, completed_at: '2026-09-01' }), trat({ id: 'A', value: 300, completed_at: '2026-09-02' })],
    )
    expect(resumo(r)).toEqual([['S', null, 30000], ['A', 'ana', 20000]])
  })
  it('fator líquido 100 -> 97 dá base 9700', () => {
    const r = alocarParticular([rec({ amount: 100, net_amount: 97 })], [trat({ value: 100 })])
    expect(r[0].brutoCentavos).toBe(10000)
    expect(r[0].baseCentavos).toBe(9700)
  })
  it('pacientes não se misturam', () => {
    const r = alocarParticular(
      [rec({ amount: 500, patient_id: 'p1' })],
      [trat({ id: 'X', value: 500, patient_id: 'p2' }), trat({ id: 'A', value: 500, patient_id: 'p1' })],
    )
    expect(resumo(r)).toEqual([['A', 'ana', 50000]])
  })
})
