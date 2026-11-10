import { describe, it, expect } from 'vitest'
import { parseProduto, parseEntrada, parseSaida, parseContagem } from '@/lib/estoque/validar'
import { parseReaisInput } from '@/lib/payments/money'

const UUID = '123e4567-e89b-42d3-a456-426614174000'
const erro = (error: string) => ({ ok: false, error })

describe('parseProduto', () => {
  it('trim e padrões', () => {
    expect(parseProduto({ name: '  Luvas M ' }, true)).toEqual({
      ok: true,
      input: { name: 'Luvas M', category: null, unit: null, minQuantity: 0, idealQuantity: null, supplier: null, trackExpiry: false },
    })
  })
  it('nome', () => {
    expect(parseProduto({ name: '   ' }, true)).toEqual(erro('Informe o nome'))
    expect(parseProduto({}, true)).toEqual(erro('Informe o nome'))
    expect(parseProduto({ name: 'a'.repeat(80) }, true).ok).toBe(true)
    expect(parseProduto({ name: 'a'.repeat(81) }, true)).toEqual(erro('Nome muito longo'))
    expect(parseProduto(null, true)).toEqual(erro('Dados inválidos'))
  })
  it('quantidades', () => {
    for (const bad of [-1, 1.5, '3']) {
      expect(parseProduto({ name: 'x', minQuantity: bad }, true)).toEqual(erro('Quantidade inválida'))
    }
    expect(parseProduto({ name: 'x', idealQuantity: -2 }, true)).toEqual(erro('Quantidade inválida'))
    expect(parseProduto({ name: 'x', minQuantity: 5, idealQuantity: 10 }, true)).toMatchObject({ input: { minQuantity: 5, idealQuantity: 10 } })
  })
  it('limites de texto', () => {
    expect(parseProduto({ name: 'x', category: 'a'.repeat(41) }, true)).toEqual(erro('Categoria muito longa'))
    expect(parseProduto({ name: 'x', unit: 'a'.repeat(41) }, true)).toEqual(erro('Unidade muito longa'))
    expect(parseProduto({ name: 'x', supplier: 'a'.repeat(81) }, true)).toEqual(erro('Fornecedor muito longo'))
    expect(parseProduto({ name: 'x', category: ' ', supplier: '' }, true)).toMatchObject({ input: { category: null, supplier: null } })
  })
  it('criação aceita saldo inicial, lote e validade; ignora active', () => {
    const r = parseProduto({ name: 'x', trackExpiry: true, initialQuantity: 10, lotCode: ' L1 ', expiresAt: '2027-01-31', active: false }, true)
    expect(r).toEqual({
      ok: true,
      input: { name: 'x', category: null, unit: null, minQuantity: 0, idealQuantity: null, supplier: null, trackExpiry: true, initialQuantity: 10, lotCode: 'L1', expiresAt: '2027-01-31' },
    })
    expect(parseProduto({ name: 'x', initialQuantity: -1 }, true)).toEqual(erro('Quantidade inválida'))
    expect(parseProduto({ name: 'x', expiresAt: '2026-02-30' }, true)).toEqual(erro('Data inválida'))
    expect(parseProduto({ name: 'x', lotCode: 'a'.repeat(41) }, true)).toEqual(erro('Lote muito longo'))
  })
  it('edição exige active booleano', () => {
    expect(parseProduto({ name: 'x' }, false)).toEqual(erro('Dados inválidos'))
    expect(parseProduto({ name: 'x', active: 'sim' }, false)).toEqual(erro('Dados inválidos'))
    expect(parseProduto({ name: 'x', active: false }, false)).toMatchObject({ ok: true, input: { active: false } })
    const r = parseProduto({ name: 'x', active: true, initialQuantity: 5 }, false)
    expect(r.ok && 'initialQuantity' in r.input).toBe(false)
  })
})

describe('parseEntrada', () => {
  const base = { quantity: 10, kind: 'compra' }
  it('quantidade e tipo', () => {
    expect(parseEntrada({ ...base, quantity: 0 })).toEqual(erro('Quantidade inválida'))
    expect(parseEntrada({ ...base, quantity: 1.5 })).toEqual(erro('Quantidade inválida'))
    expect(parseEntrada({ ...base, kind: 'uso' })).toEqual(erro('Dados inválidos'))
    expect(parseEntrada(null)).toEqual(erro('Dados inválidos'))
  })
  it('compra sem custo', () => {
    expect(parseEntrada(base)).toEqual({
      ok: true,
      input: { quantity: 10, kind: 'compra', lotCode: null, expiresAt: null, notes: null, totalCostCents: null, payment: null },
    })
  })
  it('compra paga', () => {
    const r = parseEntrada({ ...base, totalCostCents: 123456, payment: { status: 'paid', method: 'pix', date: '2026-11-10' } })
    expect(r).toMatchObject({ ok: true, input: { totalCostCents: 123456, payment: { status: 'paid', method: 'pix', date: '2026-11-10' } } })
  })
  it('pagamento incompleto bloqueia', () => {
    expect(parseEntrada({ ...base, totalCostCents: 100, payment: { status: 'paid', date: '2026-11-10' } })).toEqual(erro('Informe a forma de pagamento'))
    expect(parseEntrada({ ...base, totalCostCents: 100, payment: { status: 'paid', method: 'cheque', date: '2026-11-10' } })).toEqual(erro('Informe a forma de pagamento'))
    expect(parseEntrada({ ...base, totalCostCents: 100, payment: { status: 'pending' } })).toEqual(erro('Informe o vencimento'))
    expect(parseEntrada({ ...base, totalCostCents: 100, payment: { status: 'pending', dueDate: '2026-02-30' } })).toEqual(erro('Data inválida'))
    expect(parseEntrada({ ...base, totalCostCents: 100 })).toEqual(erro('Informe se a compra já foi paga'))
    expect(parseEntrada({ ...base, totalCostCents: 100, payment: { status: 'x' } })).toEqual(erro('Informe se a compra já foi paga'))
  })
  it('pendente ok', () => {
    expect(parseEntrada({ ...base, totalCostCents: 100, payment: { status: 'pending', dueDate: '2026-12-01' } })).toMatchObject({
      ok: true, input: { payment: { status: 'pending', dueDate: '2026-12-01' } },
    })
  })
  it('valor', () => {
    const p = { status: 'pending', dueDate: '2026-12-01' }
    expect(parseEntrada({ ...base, totalCostCents: 10000000000, payment: p })).toEqual(erro('Valor inválido'))
    for (const bad of [0, -5, 1.5, '100']) expect(parseEntrada({ ...base, totalCostCents: bad, payment: p })).toEqual(erro('Valor inválido'))
    expect(parseEntrada({ ...base, totalCostCents: 9999999999, payment: p }).ok).toBe(true)
  })
  it('só compra gera custo/pagamento', () => {
    const r = parseEntrada({ quantity: 3, kind: 'ajuste', totalCostCents: 500, payment: { status: 'paid', method: 'pix', date: '2026-11-10' } })
    expect(r).toMatchObject({ ok: true, input: { kind: 'ajuste', totalCostCents: null, payment: null } })
  })
  it('data, lote e observação', () => {
    expect(parseEntrada({ ...base, expiresAt: '2026-02-30' })).toEqual(erro('Data inválida'))
    expect(parseEntrada({ ...base, lotCode: 'a'.repeat(41) })).toEqual(erro('Lote muito longo'))
    expect(parseEntrada({ ...base, notes: 'a'.repeat(501) })).toEqual(erro('Observação muito longa'))
    expect(parseEntrada({ ...base, lotCode: ' L9 ', expiresAt: '2027-01-31', notes: ' ok ' })).toMatchObject({
      input: { lotCode: 'L9', expiresAt: '2027-01-31', notes: 'ok' },
    })
  })
  it('valores digitados em reais viram centavos', () => {
    expect(parseReaisInput('1.234,56')).toBe(123456)
    expect(parseReaisInput('R$ 80')).toBe(8000)
  })
})

describe('parseSaida', () => {
  it('ok e padrões', () => {
    expect(parseSaida({ quantity: 2, kind: 'uso' })).toEqual({ ok: true, input: { quantity: 2, kind: 'uso', lotId: null, notes: null } })
    expect(parseSaida({ quantity: 2, kind: 'perda', lotId: UUID, notes: ' x ' })).toMatchObject({ input: { lotId: UUID, notes: 'x' } })
  })
  it('erros', () => {
    expect(parseSaida({ quantity: 2, kind: 'compra' })).toEqual(erro('Dados inválidos'))
    expect(parseSaida({ quantity: 2, kind: 'uso', lotId: 'x' })).toEqual(erro('Dados inválidos'))
    expect(parseSaida({ quantity: 0, kind: 'uso' })).toEqual(erro('Quantidade inválida'))
    expect(parseSaida({ quantity: 1, kind: 'uso', notes: 'a'.repeat(501) })).toEqual(erro('Observação muito longa'))
  })
})

describe('parseContagem', () => {
  it('zero é válido', () => {
    expect(parseContagem({ counted: 0 })).toEqual({ ok: true, input: { counted: 0, lotId: null, notes: null } })
  })
  it('erros', () => {
    expect(parseContagem({ counted: -1 })).toEqual(erro('Quantidade inválida'))
    expect(parseContagem({ counted: 1.5 })).toEqual(erro('Quantidade inválida'))
    expect(parseContagem({ counted: 1, lotId: 'x' })).toEqual(erro('Dados inválidos'))
    expect(parseContagem({ counted: 1, lotId: UUID })).toMatchObject({ input: { lotId: UUID } })
  })
})
