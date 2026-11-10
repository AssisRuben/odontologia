import { describe, it, expect } from 'vitest'
import { parseKit, parseBaixa } from '@/lib/kits/validar'

const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const item = (q: unknown = 1, id: unknown = U1) => ({ itemId: id, quantity: q })
const erro = (r: unknown) => (r as { error?: string }).error

describe('parseKit', () => {
  it('cria com nome aparado e active true', () => {
    const r = parseKit({ name: '  Kit  ', items: [item(2)] }, 'criar')
    expect(r).toEqual({ ok: true, input: { name: 'Kit', active: true, items: [{ itemId: U1, quantity: 2 }] } })
  })
  it('editar sem active é inválido', () => {
    expect(parseKit({ name: 'Kit', items: [item()] }, 'editar')).toEqual({ ok: false, error: 'Dados inválidos' })
  })
  it('corpo que não é objeto / items que não é array', () => {
    expect(erro(parseKit(null, 'criar'))).toBe('Dados inválidos')
    expect(erro(parseKit({ name: 'K', items: 'x' }, 'criar'))).toBe('Dados inválidos')
  })
  it('nome vazio e longo', () => {
    expect(erro(parseKit({ name: ' ', items: [item()] }, 'criar'))).toBe('Informe o nome do kit')
    expect(erro(parseKit({ name: 'a'.repeat(81), items: [item()] }, 'criar'))).toBe('Nome muito longo')
  })
  it('limites de itens', () => {
    expect(erro(parseKit({ name: 'K', items: [] }, 'criar'))).toBe('Inclua ao menos um produto')
    const muitos = Array.from({ length: 51 }, (_, i) => item(1, `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`))
    expect(erro(parseKit({ name: 'K', items: muitos }, 'criar'))).toBe('Máximo de 50 produtos')
  })
  it.each([0, 1.5, 10000, '2'])('quantidade %s inválida', (q) => {
    expect(erro(parseKit({ name: 'K', items: [item(q)] }, 'criar'))).toBe('Quantidade inválida')
  })
  it('itemId repetido e não uuid', () => {
    expect(erro(parseKit({ name: 'K', items: [item(1, U1), item(2, U1)] }, 'criar'))).toBe('Produto repetido na lista')
    expect(erro(parseKit({ name: 'K', items: [item(1, 'x')] }, 'criar'))).toBe('Dados inválidos')
  })
})

describe('parseBaixa', () => {
  it('aceita kitId null', () => {
    const r = parseBaixa({ kitId: null, items: [item(1, U2)] })
    expect(r).toEqual({ ok: true, input: { kitId: null, items: [{ itemId: U2, quantity: 1 }] } })
  })
  it('kitId que não é uuid', () => {
    expect(erro(parseBaixa({ kitId: 'x', items: [item()] }))).toBe('Dados inválidos')
  })
})
