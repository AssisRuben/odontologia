import { describe, it, expect } from 'vitest'
import { parseSaldo, parseRecorrencia, parseEncerrar } from '@/lib/fluxo/validar'

const HOJE = '2026-11-10'
const base = {
  description: 'Aluguel', amountCentavos: 150000, category: 'aluguel', deductionGroup: 'custeio',
  paymentMethod: 'pix', dayOfMonth: 5, startMonth: '2026-11', endMonth: null,
}
const erro = (r: { ok: boolean; error?: string }) => (r.ok ? null : r.error)

describe('parseSaldo', () => {
  it('aceita saldo negativo', () => {
    const r = parseSaldo({ data: '2026-11-10', valorCentavos: -50000 }, HOJE)
    expect(r).toEqual({ ok: true, input: { data: '2026-11-10', valorCentavos: -50000 } })
  })
  it('rejeita data futura', () => {
    expect(erro(parseSaldo({ data: '2026-11-11', valorCentavos: 1 }, HOJE))).toBe('A data não pode ser futura')
  })
  it('rejeita data inválida', () => {
    expect(erro(parseSaldo({ data: '2026-02-30', valorCentavos: 1 }, HOJE))).toBe('Data inválida')
  })
  it('rejeita valor fracionado ou grande demais', () => {
    expect(erro(parseSaldo({ data: HOJE, valorCentavos: 12.5 }, HOJE))).toBe('Valor inválido')
    expect(erro(parseSaldo({ data: HOJE, valorCentavos: 100000000000 }, HOJE))).toBe('Valor inválido')
  })
})

describe('parseRecorrencia', () => {
  it('criar válido', () => {
    const r = parseRecorrencia(base, 'criar', HOJE)
    expect(r.ok && r.input).toMatchObject({ description: 'Aluguel', startMonth: '2026-11', endMonth: null })
  })
  it('dia 0 e 32 são inválidos', () => {
    expect(erro(parseRecorrencia({ ...base, dayOfMonth: 0 }, 'criar', HOJE))).toBe('Dia inválido')
    expect(erro(parseRecorrencia({ ...base, dayOfMonth: 32 }, 'criar', HOJE))).toBe('Dia inválido')
  })
  it('valor inválido', () => {
    expect(erro(parseRecorrencia({ ...base, amountCentavos: 0 }, 'criar', HOJE))).toBe('Valor inválido')
  })
  it('descrição vazia', () => {
    expect(erro(parseRecorrencia({ ...base, description: ' ' }, 'criar', HOJE))).toBe('Informe a descrição')
  })
  it('convênio não é aceito como forma de pagamento', () => {
    expect(erro(parseRecorrencia({ ...base, paymentMethod: 'convenio' }, 'criar', HOJE))).toBe('Dados inválidos')
  })
  it('endMonth antes de startMonth', () => {
    expect(erro(parseRecorrencia({ ...base, endMonth: '2026-10' }, 'criar', HOJE))).toBe('Período inválido')
  })
  it('limites de startMonth: 12 meses para cada lado', () => {
    expect(parseRecorrencia({ ...base, startMonth: '2025-11' }, 'criar', HOJE).ok).toBe(true)
    expect(parseRecorrencia({ ...base, startMonth: '2027-11' }, 'criar', HOJE).ok).toBe(true)
    expect(erro(parseRecorrencia({ ...base, startMonth: '2025-10' }, 'criar', HOJE))).toBe('Período inválido')
    expect(erro(parseRecorrencia({ ...base, startMonth: '2027-12' }, 'criar', HOJE))).toBe('Período inválido')
  })
  it('endMonth até 120 meses após startMonth', () => {
    expect(parseRecorrencia({ ...base, endMonth: '2036-11' }, 'criar', HOJE).ok).toBe(true)
    expect(erro(parseRecorrencia({ ...base, endMonth: '2036-12' }, 'criar', HOJE))).toBe('Período inválido')
  })
  it('editar sem aPartirDe dá Dados inválidos', () => {
    expect(erro(parseRecorrencia(base, 'editar', HOJE))).toBe('Dados inválidos')
  })
  it('editar ignora startMonth e endMonth', () => {
    const r = parseRecorrencia({ ...base, startMonth: 'lixo', endMonth: 'lixo', aPartirDe: '2026-12' }, 'editar', HOJE)
    expect(r.ok && r.input).toMatchObject({ aPartirDe: '2026-12' })
  })
})

describe('parseEncerrar', () => {
  it('aceita YYYY-MM', () => {
    expect(parseEncerrar({ ultimoMes: '2026-12' })).toEqual({ ok: true, ultimoMes: '2026-12' })
  })
  it('rejeita formato errado', () => {
    expect(parseEncerrar({ ultimoMes: '2026-13' }).ok).toBe(false)
    expect(parseEncerrar(null).ok).toBe(false)
  })
})
