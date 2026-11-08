import { describe, it, expect } from 'vitest'
import { extrato, resumoMes, type EntradaCalculo, type FechamentoIn, type Extrato } from '@/lib/comissoes/calculo'

const base = (o: Partial<EntradaCalculo> = {}): EntradaCalculo => ({
  recebimentos: [], tratamentos: [], itensConvenio: [], laboratorio: [],
  profissionais: [{ id: 'ana', name: 'Ana', commission_rate: 40, commission_rate_insurance: 30, commission_start: '2026-01-01' }],
  fechamentos: [], nomesPacientes: { p1: 'Paciente Um' }, ...o,
})
const rec = (id: string, amount: number, paid_at: string, extra = {}) => ({
  id, patient_id: 'p1', amount, net_amount: null, payment_method: 'pix', paid_at, created_at: paid_at + 'T10:00:00Z', ...extra,
})
const trat = (id: string, value: number, completed_at: string) => ({
  id, patient_id: 'p1', professional_id: 'ana', procedure: 'Limpeza', value, completed_at, created_at: completed_at + 'T09:00:00Z', em_guia: false,
})
const item = (o = {}) => ({
  item_id: 'i1', patient_id: 'p1', professional_id: 'ana', descricao: 'Consulta', paid_value: null, pago_em: null, recovered_value: null, recuperado_em: null, ...o,
})
const stmt = (o: Partial<Extrato> = {}): Extrato => ({
  professional_id: 'ana', nome: 'Ana', mes: '2026-10', percentual: 40, percentualConvenio: 30, partes: [], laboratorio: [],
  particularBaseCentavos: 0, convenioBaseCentavos: 0, laboratorioCustoCentavos: 0, comissaoMesCentavos: 40000, ajusteCentavos: 0, totalCentavos: 40000, ...o,
})
const fech = (o: Partial<FechamentoIn> = {}): FechamentoIn => ({
  id: 'f1', professional_id: 'ana', period: '2026-10-01', amountCentavos: 40000, status: 'fechado',
  closed_at: '2026-11-02T10:00:00Z', paid_at: null, payment_method: null, statement: stmt(), ...o,
})

describe('extrato', () => {
  it('exemplo da spec', () => {
    const e = base({
      recebimentos: [rec('r1', 1000, '2026-11-10', { net_amount: 970 })],
      tratamentos: [trat('t1', 1000, '2026-11-05')],
      itensConvenio: [item({ paid_value: 200, pago_em: '2026-11-12' })],
      laboratorio: [{ id: 'l1', professional_id: 'ana', description: 'Prótese', amount: 100, paid_at: '2026-11-15' }],
    })
    const x = extrato(e, 'ana', '2026-11')
    expect(x.particularBaseCentavos).toBe(97000)
    expect(x.convenioBaseCentavos).toBe(20000)
    expect(x.laboratorioCustoCentavos).toBe(10000)
    expect(x.comissaoMesCentavos).toBe(40800)
    expect(x.ajusteCentavos).toBe(0)
    expect(x.totalCentavos).toBe(40800)
    expect(x.partes.map(p => [p.origem, p.percentual, p.comissaoCentavos])).toEqual([['particular', 40, 38800], ['convenio', 30, 6000]])
    expect(x.partes[0]).toMatchObject({ paciente: 'Paciente Um', descricao: 'Limpeza', data: '2026-11-10' })
    expect(x.laboratorio[0]).toMatchObject({ custoCentavos: 10000, percentual: 40, descontoCentavos: 4000 })
  })
  it('percentual convênio nulo usa o particular', () => {
    const e = base({
      profissionais: [{ id: 'ana', name: 'Ana', commission_rate: 40, commission_rate_insurance: null, commission_start: '2026-01-01' }],
      itensConvenio: [item({ paid_value: 100, pago_em: '2026-11-12' })],
    })
    expect(extrato(e, 'ana', '2026-11').comissaoMesCentavos).toBe(4000)
  })
  it('recurso entra na data do recebimento', () => {
    const e = base({ itensConvenio: [item({ paid_value: 100, pago_em: '2026-10-12', recovered_value: 50, recuperado_em: '2026-11-20' })] })
    const x = extrato(e, 'ana', '2026-11')
    expect(x.partes).toHaveLength(1)
    expect(x.partes[0]).toMatchObject({ origem: 'recurso', data: '2026-11-20', baseCentavos: 5000, comissaoCentavos: 1500 })
    expect(x.ajusteCentavos).toBe(3000)
  })
  it('estorno após fechamento vira ajuste negativo', () => {
    const e = base({ fechamentos: [fech()] })
    expect(extrato(e, 'ana', '2026-12')).toMatchObject({ ajusteCentavos: -40000, totalCentavos: -40000 })
  })
  it('mês anterior não fechado vira ajuste positivo', () => {
    const e = base({ recebimentos: [rec('r1', 100, '2026-10-05')], tratamentos: [trat('t1', 100, '2026-10-01')] })
    expect(extrato(e, 'ana', '2026-11')).toMatchObject({ ajusteCentavos: 4000, comissaoMesCentavos: 0, totalCentavos: 4000 })
  })
  it('itens posteriores ao mês são ignorados', () => {
    const e = base({ recebimentos: [rec('r1', 100, '2026-12-05')], tratamentos: [trat('t1', 100, '2026-10-01')] })
    expect(extrato(e, 'ana', '2026-11')).toMatchObject({ partes: [], ajusteCentavos: 0, totalCentavos: 0 })
  })
  it('mês fechado devolve o statement', () => {
    const s = stmt({ comissaoMesCentavos: 12345, totalCentavos: 12345 })
    expect(extrato(base({ fechamentos: [fech({ statement: s })] }), 'ana', '2026-10')).toBe(s)
  })
  it('sem percentual: tudo zero', () => {
    const e = base({
      profissionais: [{ id: 'ana', name: 'Ana', commission_rate: null, commission_rate_insurance: null, commission_start: '2026-01-01' }],
      recebimentos: [rec('r1', 100, '2026-11-05')], tratamentos: [trat('t1', 100, '2026-11-01')],
    })
    expect(extrato(e, 'ana', '2026-11')).toMatchObject({ percentual: null, partes: [], laboratorio: [], totalCentavos: 0, ajusteCentavos: 0 })
  })
  it('arredondamento: base 333 x 33,33% = 111', () => {
    const e = base({
      profissionais: [{ id: 'ana', name: 'Ana', commission_rate: 33.33, commission_rate_insurance: null, commission_start: '2026-01-01' }],
      itensConvenio: [item({ paid_value: 3.33, pago_em: '2026-11-12' })],
    })
    expect(extrato(e, 'ana', '2026-11').partes[0]).toMatchObject({ baseCentavos: 333, comissaoCentavos: 111 })
  })
  it('convênio sem pagamento não gera parte', () => {
    const e = base({ itensConvenio: [item({ paid_value: 100, pago_em: null })] })
    expect(extrato(e, 'ana', '2026-11').partes).toEqual([])
  })
})

describe('mês inicial da comissão', () => {
  const comInicio = (commission_start: string | null, o: Partial<EntradaCalculo> = {}) =>
    base({ profissionais: [{ id: 'ana', name: 'Ana', commission_rate: 40, commission_rate_insurance: 30, commission_start }], ...o })

  it('histórico antes do início não vira ajuste', () => {
    const e = comInicio('2026-10-01', {
      recebimentos: [rec('r0', 500, '2026-09-20'), rec('r1', 100, '2026-10-05')],
      tratamentos: [trat('t0', 500, '2026-09-01'), trat('t1', 100, '2026-10-01')],
      itensConvenio: [item({ paid_value: 200, pago_em: '2026-09-12' })],
      laboratorio: [{ id: 'l0', professional_id: 'ana', description: 'Prótese', amount: 100, paid_at: '2026-09-15' }],
    })
    expect(extrato(e, 'ana', '2026-10')).toMatchObject({ comissaoMesCentavos: 4000, ajusteCentavos: 0, totalCentavos: 4000 })
    expect(extrato(e, 'ana', '2026-11')).toMatchObject({ comissaoMesCentavos: 0, ajusteCentavos: 4000, totalCentavos: 4000 })
  })
  it('mês anterior ao início: extrato zerado', () => {
    const e = comInicio('2026-10-01', { recebimentos: [rec('r0', 500, '2026-09-20')], tratamentos: [trat('t0', 500, '2026-09-01')] })
    expect(extrato(e, 'ana', '2026-09')).toMatchObject({ partes: [], laboratorio: [], comissaoMesCentavos: 0, ajusteCentavos: 0, totalCentavos: 0 })
  })
  it('percentual sem mês inicial: semInicio e zeros', () => {
    const e = comInicio(null, { recebimentos: [rec('r1', 100, '2026-11-05')], tratamentos: [trat('t1', 100, '2026-11-01')] })
    expect(extrato(e, 'ana', '2026-11')).toMatchObject({ partes: [], totalCentavos: 0, ajusteCentavos: 0 })
    expect(resumoMes(e, '2026-11')[0]).toMatchObject({ semInicio: true, semPercentual: false, totalCentavos: 0 })
    expect(resumoMes(base(), '2026-11')[0]).toMatchObject({ semInicio: false })
  })
})

describe('percentual congelado nos meses fechados', () => {
  const ana50 = { id: 'ana', name: 'Ana', commission_rate: 50, commission_rate_insurance: 50, commission_start: '2026-01-01' }

  it('aumento depois de mês fechado não gera ajuste', () => {
    const e = base({
      profissionais: [ana50],
      recebimentos: [rec('r1', 100, '2026-10-05')],
      tratamentos: [trat('t1', 100, '2026-10-01')],
      itensConvenio: [item({ paid_value: 100, pago_em: '2026-10-12' })],
      fechamentos: [fech({ amountCentavos: 7000, statement: stmt({ percentual: 40, percentualConvenio: 30, totalCentavos: 7000 }) })],
    })
    expect(extrato(e, 'ana', '2026-11')).toMatchObject({ ajusteCentavos: 0, totalCentavos: 0 })
  })
  it('percentual convênio nulo no mês fechado usa o particular congelado', () => {
    const e = base({
      profissionais: [ana50],
      itensConvenio: [item({ paid_value: 100, pago_em: '2026-10-12' })],
      fechamentos: [fech({ amountCentavos: 4000, statement: stmt({ percentual: 40, percentualConvenio: null, totalCentavos: 4000 }) })],
    })
    expect(extrato(e, 'ana', '2026-11').ajusteCentavos).toBe(0)
  })
  it('estorno em mês fechado ajusta pelo percentual congelado', () => {
    const e = base({
      profissionais: [ana50],
      recebimentos: [rec('r1', 100, '2026-10-05')],
      tratamentos: [trat('t1', 100, '2026-10-01'), trat('t2', 100, '2026-10-02')],
      fechamentos: [fech({ amountCentavos: 8000, statement: stmt({ percentual: 40, totalCentavos: 8000 }) })],
    })
    expect(extrato(e, 'ana', '2026-11')).toMatchObject({ ajusteCentavos: -4000, totalCentavos: -4000 })
  })
  it('mês aberto usa o percentual atual', () => {
    const e = base({ profissionais: [ana50], recebimentos: [rec('r1', 100, '2026-11-05')], tratamentos: [trat('t1', 100, '2026-11-01')] })
    expect(extrato(e, 'ana', '2026-11').partes[0]).toMatchObject({ percentual: 50, comissaoCentavos: 5000 })
  })
})

describe('resumoMes', () => {
  it('ordena por nome e marca situação', () => {
    const e = base({
      profissionais: [
        { id: 'ze', name: 'Zé', commission_rate: null, commission_rate_insurance: null, commission_start: '2026-01-01' },
        { id: 'ana', name: 'Ana', commission_rate: 40, commission_rate_insurance: null, commission_start: '2026-01-01' },
      ],
      fechamentos: [fech({ status: 'pago', paid_at: '2026-11-05', payment_method: 'pix' })],
    })
    const r = resumoMes(e, '2026-10')
    expect(r.map(x => x.nome)).toEqual(['Ana', 'Zé'])
    expect(r[0]).toMatchObject({ situacao: 'pago', semPercentual: false, totalCentavos: 40000 })
    expect(r[0].fechamento).toMatchObject({ id: 'f1', paid_at: '2026-11-05' })
    expect(r[0].fechamento).not.toHaveProperty('statement')
    expect(r[1]).toMatchObject({ situacao: 'aberto', semPercentual: true, totalCentavos: 0, fechamento: null })
  })
})
