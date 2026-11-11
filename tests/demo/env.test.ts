import { describe, it, expect } from 'vitest'
import { atualizarEnv } from '../../scripts/demo/env.mjs'

describe('atualizarEnv', () => {
  it('troca linhas existentes, inclusive comentadas', () => {
    const antes = 'A=1\nMANUAL_EMAIL=velho\n# MANUAL_SENHA=x\nB=2\n'
    expect(atualizarEnv(antes, { MANUAL_EMAIL: 'demo@manual.local', MANUAL_SENHA: 'abc' }))
      .toBe('A=1\nMANUAL_EMAIL=demo@manual.local\nMANUAL_SENHA=abc\nB=2\n')
  })
  it('acrescenta no fim o que não existe', () => {
    expect(atualizarEnv('A=1', { MANUAL_EMAIL: 'e' })).toBe('A=1\nMANUAL_EMAIL=e\n')
    expect(atualizarEnv('', { MANUAL_EMAIL: 'e' })).toBe('MANUAL_EMAIL=e\n')
  })
  it('preserva \\r\\n e não mexe em chaves parecidas', () => {
    const antes = 'MANUAL_EMAIL_X=1\r\nMANUAL_EMAIL=a\r\n'
    expect(atualizarEnv(antes, { MANUAL_EMAIL: 'b' })).toBe('MANUAL_EMAIL_X=1\r\nMANUAL_EMAIL=b\r\n')
  })
})
