import { describe, it, expect } from 'vitest'
import { validarPercentual, validarFechamento, validarPagamentoComissao, validarComissaoProfissional } from '@/lib/comissoes/validar'

const ID = '11111111-1111-4111-8111-111111111111'

describe('validarPercentual', () => {
  it('aceita número e texto com vírgula', () => {
    expect(validarPercentual('40,5', false)).toEqual({ ok: true, valor: 40.5 })
    expect(validarPercentual(40, false)).toEqual({ ok: true, valor: 40 })
    expect(validarPercentual(0, false)).toEqual({ ok: true, valor: 0 })
    expect(validarPercentual('100', false)).toEqual({ ok: true, valor: 100 })
  })
  it('recusa fora da faixa ou com 3 casas', () => {
    for (const v of [101, -1, '12,345', 'abc', NaN]) {
      expect(validarPercentual(v, false)).toEqual({ ok: false, error: 'Percentual inválido' })
    }
  })
  it('vazio só se opcional', () => {
    expect(validarPercentual('', true)).toEqual({ ok: true, valor: null })
    expect(validarPercentual(null, true)).toEqual({ ok: true, valor: null })
    expect(validarPercentual('', false)).toEqual({ ok: false, error: 'Percentual inválido' })
  })
})

describe('validarFechamento', () => {
  it('ok', () => {
    expect(validarFechamento({ professionalId: ID, mes: '2026-10' })).toEqual({ ok: true, professionalId: ID, mes: '2026-10' })
  })
  it('erros', () => {
    expect(validarFechamento({ professionalId: 'x', mes: '2026-10' })).toMatchObject({ ok: false, error: 'Identificador inválido', status: 422 })
    expect(validarFechamento({ professionalId: ID, mes: '2026-13' })).toMatchObject({ ok: false, error: 'Mês inválido', status: 422 })
    expect(validarFechamento(null)).toMatchObject({ ok: false, status: 422 })
  })
})

describe('validarPagamentoComissao', () => {
  it('ok', () => {
    expect(validarPagamentoComissao({ paidAt: '2026-11-05', paymentMethod: 'pix' })).toEqual({ ok: true, paidAt: '2026-11-05', paymentMethod: 'pix' })
  })
  it('erros', () => {
    expect(validarPagamentoComissao({ paidAt: '2026-02-30', paymentMethod: 'pix' })).toMatchObject({ ok: false, error: 'Data inválida', status: 422 })
    expect(validarPagamentoComissao({ paidAt: '2026-11-05', paymentMethod: 'convenio' })).toMatchObject({ ok: false, error: 'Forma de pagamento inválida', status: 422 })
  })
})

describe('validarComissaoProfissional', () => {
  const v = (rate: string, rateInsurance: string, inicio: string) => validarComissaoProfissional({ rate, rateInsurance, inicio })
  it('percentual com mês inicial', () => {
    expect(v('40', '30,5', '2026-10')).toEqual({ ok: true, rate: 40, rateInsurance: 30.5, inicio: '2026-10-01' })
  })
  it('tudo vazio', () => {
    expect(v('', '', '')).toEqual({ ok: true, rate: null, rateInsurance: null, inicio: null })
  })
  it('percentual inválido', () => {
    expect(v('101', '', '2026-10')).toEqual({ ok: false, error: 'Percentual inválido' })
    expect(v('40', 'x', '2026-10')).toEqual({ ok: false, error: 'Percentual inválido' })
  })
  it('convênio sem particular é recusado', () => {
    expect(v('', '30', '2026-10')).toEqual({ ok: false, error: 'Informe o percentual particular' })
  })
  it('particular exige mês inicial', () => {
    expect(v('40', '', '')).toEqual({ ok: false, error: 'Informe o mês inicial da comissão' })
    expect(v('40', '', '2026-13')).toEqual({ ok: false, error: 'Mês inválido' })
  })
  it('sem percentual o mês inicial é mantido se informado', () => {
    expect(v('', '', '2026-10')).toEqual({ ok: true, rate: null, rateInsurance: null, inicio: '2026-10-01' })
  })
})
