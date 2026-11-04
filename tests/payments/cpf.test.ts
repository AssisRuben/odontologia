import { describe, expect, it } from 'vitest'
import { isValidCpf, normalizeCpf } from '@/lib/payments/cpf'
import { fromCents, toCents } from '@/lib/payments/money'

describe('cpf', () => {
  it('normaliza CPF válido', () => {
    expect(normalizeCpf('529.982.247-25')).toBe('52998224725')
    expect(isValidCpf('529.982.247-25')).toBe(true)
  })
  it('rejeita dígitos repetidos', () => {
    expect(normalizeCpf('111.111.111-11')).toBeNull()
  })
  it('rejeita dígito verificador errado', () => {
    expect(normalizeCpf('529.982.247-24')).toBeNull()
    expect(isValidCpf('123')).toBe(false)
  })
})

describe('money', () => {
  it('converte reais e centavos', () => {
    expect(toCents(19.9)).toBe(1990)
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(fromCents(1990)).toBe(19.9)
  })
})
