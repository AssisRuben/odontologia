import { describe, it, expect } from 'vitest'
import { situacaoPagamento, rotuloSituacao } from '@/lib/convenios/pagamentos/situacao'

const item = (o: Partial<Parameters<typeof situacaoPagamento>[0]> = {}) => ({
  paid_value: 100, glosa_value: 0, appeal_status: 'nenhum' as const,
  recovered_value: null, recovered_payment_id: null, ...o,
})

describe('situacaoPagamento', () => {
  it('paid_value nulo é aguardando', () => {
    expect(situacaoPagamento(item({ paid_value: null, glosa_value: null }))).toBe('aguardando')
  })
  it('glosa 0 é pago', () => {
    expect(situacaoPagamento(item())).toBe('pago')
    expect(situacaoPagamento(item({ glosa_value: null }))).toBe('pago')
  })
  it('glosa sem recurso é glosado', () => {
    expect(situacaoPagamento(item({ paid_value: 60, glosa_value: 40 }))).toBe('glosado')
  })
  it('em recurso', () => {
    expect(situacaoPagamento(item({ glosa_value: 40, appeal_status: 'em_recurso' }))).toBe('em_recurso')
  })
  it('negado é glosa definitiva', () => {
    expect(situacaoPagamento(item({ glosa_value: 40, appeal_status: 'negado' }))).toBe('glosa_definitiva')
  })
  it('aceito sem recebimento aguarda; com recebimento é recuperado', () => {
    const base = { glosa_value: 40, appeal_status: 'aceito' as const, recovered_value: 40 }
    expect(situacaoPagamento(item(base))).toBe('aceito_aguardando')
    expect(situacaoPagamento(item({ ...base, recovered_payment_id: 'pay1' }))).toBe('recuperado')
  })
})

describe('rotuloSituacao', () => {
  it('rótulos', () => {
    expect(rotuloSituacao('aguardando')).toBe('Aguardando pagamento')
    expect(rotuloSituacao('pago')).toBe('Pago')
    expect(rotuloSituacao('glosado')).toBe('Glosado')
    expect(rotuloSituacao('em_recurso')).toBe('Em recurso')
    expect(rotuloSituacao('recuperado')).toBe('Recuperado')
    expect(rotuloSituacao('glosa_definitiva')).toBe('Glosa definitiva')
    expect(rotuloSituacao('aceito_aguardando')).toBe('Aceito — aguardando pagamento')
  })
})
