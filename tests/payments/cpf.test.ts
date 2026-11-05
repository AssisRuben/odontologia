import { describe, expect, it } from 'vitest'
import { isValidCpf, normalizeCpf } from '@/lib/payments/cpf'

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
