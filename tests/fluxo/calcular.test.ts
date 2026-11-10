import { describe, it, expect } from 'vitest'
import { montarFluxo, dataSaoPaulo, type PagamentoFluxo, type DespesaFluxo } from '@/lib/fluxo/calcular'

const hoje = '2026-11-10'

function pag(p: Partial<PagamentoFluxo>): PagamentoFluxo {
  return { id: 'p' + Math.random(), valorCentavos: 1000, liquidoCentavos: null, status: 'pending', vencimento: null, pagoEm: null, descricao: 'Paciente', ...p }
}
function desp(d: Partial<DespesaFluxo>): DespesaFluxo {
  return { id: 'd' + Math.random(), valorCentavos: 1000, status: 'pending', vencimento: null, pagoEm: null, descricao: 'Despesa', recorrente: false, ...d }
}
const base = { hoje, saldo: null, pagamentos: [], despesas: [] }
const mes = (f: ReturnType<typeof montarFluxo>, m: string) => f.meses.find(x => x.mes === m)!

describe('montarFluxo', () => {
  it('janela de 8 meses', () => {
    const f = montarFluxo(base)
    expect(f.meses.map(m => m.mes)).toEqual(['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04'])
    expect(f.meses.map(m => m.situacao)).toEqual(['realizado', 'realizado', 'atual', 'previsto', 'previsto', 'previsto', 'previsto', 'previsto'])
  })

  it('sem saldo e sem lançamentos', () => {
    const f = montarFluxo(base)
    expect(f.semSaldoInformado).toBe(true)
    expect(f.saldoHojeCentavos).toBe(0)
    expect(f.saldoFinalPrevistoCentavos).toBe(0)
    expect(f.menorSaldo).toEqual({ valorCentavos: 0, data: '2026-11-10' })
    expect(f.emAtraso).toEqual({ totalCentavos: 0, quantidade: 0 })
    for (const m of f.meses) expect([m.saldoInicialCentavos, m.entradasCentavos, m.saidasCentavos, m.saldoFinalCentavos]).toEqual([0, 0, 0, 0])
  })

  it('saldo informado no meio de outubro', () => {
    const f = montarFluxo({
      ...base,
      saldo: { data: '2026-10-15', valorCentavos: 100000 },
      pagamentos: [pag({ status: 'paid', valorCentavos: 50000, pagoEm: '2026-10-10T15:00:00Z' })],
      despesas: [desp({ status: 'paid', valorCentavos: 20000, pagoEm: '2026-10-20T15:00:00Z' })],
    })
    expect(f.semSaldoInformado).toBe(false)
    const out = mes(f, '2026-10')
    expect(out.saldoInicialCentavos).toBe(50000)
    expect(out.saldoFinalCentavos).toBe(80000)
    expect(f.saldoHojeCentavos).toBe(80000)
  })

  it('usa o valor líquido', () => {
    const f = montarFluxo({ ...base, pagamentos: [pag({ status: 'paid', valorCentavos: 10000, liquidoCentavos: 9500, pagoEm: '2026-11-05T15:00:00Z' })] })
    expect(mes(f, '2026-11').entradasCentavos).toBe(9500)
  })

  it('pagamento atrasado fica fora do saldo', () => {
    const f = montarFluxo({ ...base, pagamentos: [pag({ status: 'overdue', valorCentavos: 30000, vencimento: '2026-11-05' })] })
    expect(f.emAtraso).toEqual({ totalCentavos: 30000, quantidade: 1 })
    expect(mes(f, '2026-11').entradasCentavos).toBe(0)
    expect(f.saldoFinalPrevistoCentavos).toBe(0)
  })

  it('pagamento pendente futuro é previsto', () => {
    const f = montarFluxo({ ...base, pagamentos: [pag({ valorCentavos: 40000, vencimento: '2026-12-05' })] })
    const dez = mes(f, '2026-12')
    expect(dez.entradasCentavos).toBe(40000)
    expect(dez.dias).toHaveLength(1)
    expect(dez.dias[0].data).toBe('2026-12-05')
    expect(dez.dias[0].movimentos[0]).toMatchObject({ tipo: 'entrada', previsto: true })
  })

  it('despesa vencida sai hoje', () => {
    const f = montarFluxo({ ...base, despesas: [desp({ valorCentavos: 15000, vencimento: '2026-11-03' })] })
    const dia = mes(f, '2026-11').dias[0]
    expect(dia.data).toBe('2026-11-10')
    expect(dia.movimentos[0]).toMatchObject({ tipo: 'saida', valorCentavos: 15000, previsto: true })
  })

  it('despesa sem vencimento sai hoje', () => {
    const f = montarFluxo({ ...base, despesas: [desp({ valorCentavos: 7000 })] })
    expect(mes(f, '2026-11').dias[0].data).toBe('2026-11-10')
    expect(mes(f, '2026-11').saidasCentavos).toBe(7000)
  })

  it('pagamento não pago sem vencimento fica de fora', () => {
    const f = montarFluxo({ ...base, pagamentos: [pag({ valorCentavos: 9000 }), pag({ status: 'overdue', valorCentavos: 9000 })] })
    expect(f.emAtraso).toEqual({ totalCentavos: 0, quantidade: 0 })
    expect(f.meses.every(m => m.entradasCentavos === 0)).toBe(true)
  })

  it('ignora cancelados e estornados', () => {
    const f = montarFluxo({
      ...base,
      pagamentos: [
        pag({ status: 'cancelled', vencimento: '2026-12-05', pagoEm: '2026-11-05T15:00:00Z' }),
        pag({ status: 'refunded', vencimento: '2026-12-05', pagoEm: '2026-11-05T15:00:00Z' }),
      ],
    })
    expect(f.meses.every(m => m.entradasCentavos === 0 && m.dias.length === 0)).toBe(true)
    expect(f.emAtraso.quantidade).toBe(0)
  })

  it('menor saldo', () => {
    const f = montarFluxo({
      ...base,
      saldo: { data: '2026-11-10', valorCentavos: 10000 },
      despesas: [desp({ valorCentavos: 30000, vencimento: '2027-01-10' })],
    })
    expect(f.menorSaldo).toEqual({ valorCentavos: -20000, data: '2027-01-10' })
    expect(f.saldoFinalPrevistoCentavos).toBe(-20000)
  })

  it('fuso de São Paulo', () => {
    expect(dataSaoPaulo('2026-11-01T02:30:00Z')).toBe('2026-10-31')
    const f = montarFluxo({ ...base, pagamentos: [pag({ status: 'paid', valorCentavos: 4000, pagoEm: '2026-11-01T02:30:00Z' })] })
    expect(mes(f, '2026-10').entradasCentavos).toBe(4000)
    expect(mes(f, '2026-11').entradasCentavos).toBe(0)
  })

  it('saldo informado antes da janela', () => {
    const f = montarFluxo({
      ...base,
      saldo: { data: '2026-07-01', valorCentavos: 0 },
      pagamentos: [pag({ status: 'paid', valorCentavos: 5000, pagoEm: '2026-08-15T15:00:00Z' })],
    })
    expect(mes(f, '2026-09').saldoInicialCentavos).toBe(5000)
  })

  it('dias só com movimento, em ordem crescente', () => {
    const f = montarFluxo({
      ...base,
      pagamentos: [pag({ vencimento: '2026-12-20' }), pag({ vencimento: '2026-12-03' })],
      despesas: [desp({ vencimento: '2026-12-10' })],
    })
    expect(mes(f, '2026-12').dias.map(d => d.data)).toEqual(['2026-12-03', '2026-12-10', '2026-12-20'])
  })
})
