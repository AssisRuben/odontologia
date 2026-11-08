import { describe, it, expect } from 'vitest'
import {
  validarPagamento, validarRecurso, validarResultado, validarRecebimento,
} from '@/lib/convenios/pagamentos/validar'

const lote = [{ id: 'a', value: 100 }, { id: 'b', value: 50 }]
const pag = (itens: unknown, o: Record<string, unknown> = {}) => ({
  paidAt: '2026-11-07', deposit: 120, itens, ...o,
})
const erro = (error: string) => ({ ok: false, error, status: 422 })

describe('validarPagamento', () => {
  it('ok com glosa e motivo', () => {
    const r = validarPagamento(pag([
      { id: 'a', paidValue: 100 },
      { id: 'b', paidValue: 20, glosaCode: '1801', glosaNote: ' sem cobertura ' },
    ]), lote)
    expect(r).toEqual({
      ok: true,
      dados: {
        paidAt: '2026-11-07', deposit: 120,
        itens: [
          { id: 'a', paidValue: 100, glosaCode: null, glosaNote: null },
          { id: 'b', paidValue: 20, glosaCode: '1801', glosaNote: 'sem cobertura' },
        ],
      },
    })
  })
  it('pago acima do enviado', () => {
    expect(validarPagamento(pag([{ id: 'a', paidValue: 150 }, { id: 'b', paidValue: 50 }]), lote))
      .toEqual(erro('Valor pago inválido'))
  })
  it('mais de 2 casas, negativo e não numérico', () => {
    for (const v of [12.345, -1, NaN, Infinity, '10', null]) {
      expect(validarPagamento(pag([{ id: 'a', paidValue: v }, { id: 'b', paidValue: 50 }]), lote))
        .toEqual(erro('Valor pago inválido'))
    }
  })
  it('item faltando, extra ou repetido', () => {
    const msg = erro('Informe todos os itens do lote')
    expect(validarPagamento(pag([{ id: 'a', paidValue: 100 }]), lote)).toEqual(msg)
    expect(validarPagamento(pag([{ id: 'a', paidValue: 100 }, { id: 'x', paidValue: 1 }]), lote)).toEqual(msg)
    expect(validarPagamento(pag([{ id: 'a', paidValue: 100 }, { id: 'a', paidValue: 100 }]), lote)).toEqual(msg)
    expect(validarPagamento(pag('x'), lote)).toEqual(msg)
  })
  it('glosa sem motivo ou com motivo malformado', () => {
    const msg = erro('Informe o motivo da glosa')
    expect(validarPagamento(pag([{ id: 'a', paidValue: 90 }, { id: 'b', paidValue: 50 }]), lote)).toEqual(msg)
    expect(validarPagamento(pag([{ id: 'a', paidValue: 90, glosaCode: '17' }, { id: 'b', paidValue: 50 }]), lote)).toEqual(msg)
  })
  it('sem glosa descarta motivo e nota', () => {
    const r = validarPagamento(pag([
      { id: 'a', paidValue: 100, glosaCode: '1801', glosaNote: 'x' }, { id: 'b', paidValue: 50 },
    ]), lote)
    expect(r.ok && r.dados.itens[0]).toEqual({ id: 'a', paidValue: 100, glosaCode: null, glosaNote: null })
  })
  it('nota acima de 200 caracteres', () => {
    const r = validarPagamento(pag([
      { id: 'a', paidValue: 90, glosaCode: '1801', glosaNote: 'x'.repeat(201) }, { id: 'b', paidValue: 50 },
    ]), lote)
    expect(r.ok).toBe(false)
  })
  it('pago zero com motivo é válido', () => {
    const r = validarPagamento(pag([
      { id: 'a', paidValue: 0, glosaCode: '1801' }, { id: 'b', paidValue: 50 },
    ]), lote)
    expect(r.ok).toBe(true)
  })
  it('data e depósito inválidos', () => {
    const itens = [{ id: 'a', paidValue: 100 }, { id: 'b', paidValue: 50 }]
    expect(validarPagamento(pag(itens, { paidAt: '2026-02-30' }), lote)).toEqual(erro('Data inválida'))
    expect(validarPagamento(pag(itens, { deposit: -1 }), lote)).toEqual(erro('Valor depositado inválido'))
    expect(validarPagamento(pag(itens, { deposit: 1.005 }), lote)).toEqual(erro('Valor depositado inválido'))
    expect(validarPagamento(pag(itens, { deposit: 0 }), lote).ok).toBe(true)
  })
  it('corpo que não é objeto', () => {
    expect(validarPagamento(null, lote)).toEqual(erro('Data inválida'))
  })
})

describe('validarRecurso', () => {
  it('ok', () => {
    expect(validarRecurso({ appealAt: '2026-11-08', appealText: ' Cobertura prevista ' }))
      .toEqual({ ok: true, dados: { appealAt: '2026-11-08', appealText: 'Cobertura prevista' } })
  })
  it('justificativa vazia ou longa', () => {
    expect(validarRecurso({ appealAt: '2026-11-08', appealText: '  ' })).toEqual(erro('Informe a justificativa'))
    expect(validarRecurso({ appealAt: '2026-11-08', appealText: 'x'.repeat(2001) })).toEqual(erro('Informe a justificativa'))
    expect(validarRecurso({ appealAt: '2026-11-08', appealText: 'x'.repeat(2000) }).ok).toBe(true)
  })
  it('data inválida', () => {
    expect(validarRecurso({ appealAt: 'ontem', appealText: 'x' })).toEqual(erro('Data inválida'))
  })
})

describe('validarResultado', () => {
  it('aceito', () => {
    expect(validarResultado({ resultado: 'aceito', resultAt: '2026-11-08', recoveredValue: 30 }, 40))
      .toEqual({ ok: true, dados: { resultado: 'aceito', resultAt: '2026-11-08', recoveredValue: 30, receivedAt: null } })
    const r = validarResultado({ resultado: 'aceito', resultAt: '2026-11-08', recoveredValue: 40, receivedAt: '2026-11-09' }, 40)
    expect(r.ok && r.dados.receivedAt).toBe('2026-11-09')
  })
  it('aceito com recuperado acima da glosa, zero ou 3 casas', () => {
    for (const v of [41, 0, 10.123, undefined]) {
      expect(validarResultado({ resultado: 'aceito', resultAt: '2026-11-08', recoveredValue: v }, 40))
        .toEqual(erro('Valor recuperado inválido'))
    }
  })
  it('negado ignora valor e recebimento', () => {
    expect(validarResultado({ resultado: 'negado', resultAt: '2026-11-08', recoveredValue: 999, receivedAt: 'lixo' }, 40))
      .toEqual({ ok: true, dados: { resultado: 'negado', resultAt: '2026-11-08', recoveredValue: null, receivedAt: null } })
  })
  it('resultado desconhecido e data inválida', () => {
    expect(validarResultado({ resultado: 'talvez', resultAt: '2026-11-08' }, 40).ok).toBe(false)
    expect(validarResultado({ resultado: 'negado', resultAt: '' }, 40)).toEqual(erro('Data inválida'))
    expect(validarResultado({ resultado: 'aceito', resultAt: '2026-11-08', recoveredValue: 10, receivedAt: '2026-13-01' }, 40))
      .toEqual(erro('Data inválida'))
  })
})

describe('validarRecebimento', () => {
  it('valor padrão é o recuperado', () => {
    expect(validarRecebimento({ receivedAt: '2026-11-09' }, 30))
      .toEqual({ ok: true, dados: { value: 30, receivedAt: '2026-11-09' } })
  })
  it('valor informado dentro da faixa', () => {
    expect(validarRecebimento({ value: 25.5, receivedAt: '2026-11-09' }, 30).ok).toBe(true)
  })
  it('valor fora da faixa', () => {
    for (const v of [0, 30.01, -1, 1.234]) {
      expect(validarRecebimento({ value: v, receivedAt: '2026-11-09' }, 30)).toEqual(erro('Valor recuperado inválido'))
    }
  })
  it('data inválida', () => {
    expect(validarRecebimento({ receivedAt: 'x' }, 30)).toEqual(erro('Data inválida'))
  })
})
