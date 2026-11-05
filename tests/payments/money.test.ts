import { describe, expect, it } from 'vitest'
import { fromCents, parseReaisInput, toCents } from '@/lib/payments/money'

describe('money', () => {
  it('converte reais e centavos', () => {
    expect(toCents(19.9)).toBe(1990)
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(fromCents(1990)).toBe(19.9)
  })
})

describe('parseReaisInput', () => {
  it.each([
    ['1.234,56', 123456],
    ['1234,56', 123456],
    ['1234.56', 123456],
    ['10.5', 1050],
    ['50,5', 5050],
    ['1.234', 123400],
    ['R$ 2.000,00', 200000],
    ['  R$2.000 ', 200000],
    ['0', 0],
    ['1.234.567', 123456700],
  ])('%s -> %s', (input, cents) => {
    expect(parseReaisInput(input)).toBe(cents)
  })
  it.each(['12abc', '1,2,3', '', '  ', '1.23.4', '1,234,56', '12,345', '1.2345,00', '-5', '10,'])('%j -> null', (input) => {
    expect(parseReaisInput(input)).toBeNull()
  })
})
