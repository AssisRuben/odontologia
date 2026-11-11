import { describe, it, expect } from 'vitest'
import { lerAmbiente, verificarLogin, resumir } from '../../scripts/manual/util.mjs'

describe('lerAmbiente', () => {
  it('exige e-mail e senha da conta de demonstração', () => {
    expect(() => lerAmbiente({})).toThrow('Defina MANUAL_EMAIL e MANUAL_SENHA no .env.local (conta de demonstração)')
    expect(() => lerAmbiente({ MANUAL_EMAIL: 'a' })).toThrow('Defina MANUAL_EMAIL e MANUAL_SENHA')
  })
  it('usa localhost:3000 por padrão', () => {
    expect(lerAmbiente({ MANUAL_EMAIL: 'a', MANUAL_SENHA: 'b' })).toEqual({ url: 'http://localhost:3000', email: 'a', senha: 'b' })
  })
  it('tira a barra do fim da URL', () => {
    expect(lerAmbiente({ MANUAL_EMAIL: 'a', MANUAL_SENHA: 'b', MANUAL_URL: 'http://x:4000/' }).url).toBe('http://x:4000')
  })
})

describe('verificarLogin', () => {
  it('acusa quando continua na tela de login', () => {
    expect(() => verificarLogin('http://localhost:3000/login?x')).toThrow('Não consegui entrar com MANUAL_EMAIL — confira e-mail e senha')
  })
  it('aceita quando saiu do login', () => {
    expect(() => verificarLogin('http://localhost:3000/agenda')).not.toThrow()
  })
})

describe('resumir', () => {
  it('conta acertos e lista falhas', () => {
    expect(resumir([{ arquivo: 'a' }, { arquivo: 'b', erro: 'timeout' }]))
      .toEqual({ texto: '1 capturas ok, 1 falharam\n- b: timeout', falhou: true })
  })
  it('sem falhas', () => {
    expect(resumir([{ arquivo: 'a' }])).toEqual({ texto: '1 capturas ok, 0 falharam', falhou: false })
  })
})
