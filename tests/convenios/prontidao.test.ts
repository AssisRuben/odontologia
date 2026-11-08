import { describe, it, expect } from 'vitest'
import { itemPronto, dataExecucao } from '@/lib/convenios/prontidao'

const base = { active: true, authorization: 'autorizado' as const, batch_id: null }
const concluido = { status: 'completed' as const }

describe('itemPronto', () => {
  it('verdadeiro para autorizado e nao_exige concluídos', () => {
    expect(itemPronto(base, concluido)).toBe(true)
    expect(itemPronto({ ...base, authorization: 'nao_exige' }, concluido)).toBe(true)
  })
  it('falso para inativo, pendente, negado, com lote, não concluído ou nulo', () => {
    expect(itemPronto({ ...base, active: false }, concluido)).toBe(false)
    expect(itemPronto({ ...base, authorization: 'pendente' }, concluido)).toBe(false)
    expect(itemPronto({ ...base, authorization: 'negado' }, concluido)).toBe(false)
    expect(itemPronto({ ...base, batch_id: 'l1' }, concluido)).toBe(false)
    expect(itemPronto(base, { status: 'in_progress' })).toBe(false)
    expect(itemPronto(base, null)).toBe(false)
  })
})

describe('dataExecucao', () => {
  it('prefere executed_at', () => {
    expect(dataExecucao({ executed_at: '2026-03-05' }, { completed_at: '2026-03-09T10:00:00Z' })).toBe('2026-03-05')
  })
  it('usa completed_at (só a data) quando não há executed_at', () => {
    expect(dataExecucao({ executed_at: null }, { completed_at: '2026-03-09T10:00:00Z' })).toBe('2026-03-09')
  })
  it('nulo sem nenhuma data', () => {
    expect(dataExecucao({ executed_at: null }, { completed_at: null })).toBeNull()
    expect(dataExecucao({ executed_at: null }, null)).toBeNull()
  })
})
