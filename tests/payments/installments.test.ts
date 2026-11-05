import { describe, expect, it } from 'vitest'
import { splitInstallments, validateChargeInput } from '@/lib/payments/installments'

describe('splitInstallments', () => {
  it('splits 100000 cents in 3 with remainder on last', () => {
    const r = splitInstallments(100000, 3, '2027-01-10')
    expect(r.map((i) => i.amountCents)).toEqual([33333, 33333, 33334])
    expect(r.map((i) => i.number)).toEqual([1, 2, 3])
  })
  it('keeps day 31 across short months', () => {
    expect(splitInstallments(30000, 3, '2027-01-31').map((i) => i.dueDate)).toEqual([
      '2027-01-31', '2027-02-28', '2027-03-31',
    ])
  })
  it('handles leap year', () => {
    expect(splitInstallments(20000, 2, '2028-01-31').map((i) => i.dueDate)).toEqual([
      '2028-01-31', '2028-02-29',
    ])
  })
  it('crosses year boundary', () => {
    expect(splitInstallments(30000, 3, '2026-12-10').map((i) => i.dueDate)).toEqual([
      '2026-12-10', '2027-01-10', '2027-02-10',
    ])
  })
  it('single installment returns one item', () => {
    expect(splitInstallments(5000, 1, '2027-01-10')).toEqual([
      { number: 1, amountCents: 5000, dueDate: '2027-01-10' },
    ])
  })
})

describe('validateChargeInput', () => {
  const ok = { amountCents: 100000, installmentCount: 2, firstDueDate: '2027-01-10', today: '2026-11-04' }
  it('aceita entrada válida', () => {
    expect(validateChargeInput(ok)).toBeNull()
  })
  it('valor zero', () => {
    expect(validateChargeInput({ ...ok, amountCents: 0 })).toBe('Informe um valor maior que zero')
  })
  it('mais de 12 parcelas', () => {
    expect(validateChargeInput({ ...ok, installmentCount: 13 })).toBe('Máximo de 12 parcelas')
  })
  it('zero parcelas', () => {
    expect(validateChargeInput({ ...ok, installmentCount: 0 })).toBe('Mínimo de 1 parcela')
  })
  it('vencimento no passado', () => {
    expect(validateChargeInput({ ...ok, firstDueDate: '2026-11-03' })).toBe('O vencimento não pode ser no passado')
  })
  it('vencimento hoje é permitido', () => {
    expect(validateChargeInput({ ...ok, firstDueDate: '2026-11-04' })).toBeNull()
  })
  it('parcela menor que R$ 5,00', () => {
    expect(validateChargeInput({ ...ok, amountCents: 900 })).toBe('Cada parcela precisa ser de pelo menos R$ 5,00')
  })
})
