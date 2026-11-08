import { describe, it, expect } from 'vitest'
import { destinoDoItem, planejarLotes, atrasado, adiarAte } from '@/lib/convenios/lotes'

describe('destinoDoItem', () => {
  it('período da data de execução', () => {
    expect(destinoDoItem('2026-03-05', null, 10, [])).toEqual({ start: '2026-02-11', end: '2026-03-10' })
  })
  it('item de período enviado vai para o próximo aberto', () => {
    const lotes = [{ period_end: '2026-03-10', status: 'enviado' as const }]
    expect(destinoDoItem('2026-03-05', null, 10, lotes)).toEqual({ start: '2026-03-11', end: '2026-04-10' })
  })
  it('lote aberto não desvia', () => {
    const lotes = [{ period_end: '2026-03-10', status: 'aberto' as const }]
    expect(destinoDoItem('2026-03-05', null, 10, lotes).end).toBe('2026-03-10')
  })
  it('avança por vários períodos enviados', () => {
    const lotes = [
      { period_end: '2026-03-10', status: 'enviado' as const },
      { period_end: '2026-04-10', status: 'enviado' as const },
    ]
    expect(destinoDoItem('2026-03-05', null, 10, lotes).end).toBe('2026-05-10')
  })
  it('defer_until posterior empurra o período', () => {
    expect(destinoDoItem('2026-03-05', '2026-03-11', 10, []).end).toBe('2026-04-10')
  })
  it('defer_until anterior à execução é ignorado', () => {
    expect(destinoDoItem('2026-03-05', '2026-01-01', 10, []).end).toBe('2026-03-10')
  })
})

describe('planejarLotes', () => {
  it('cria só os períodos que faltam, sem repetir', () => {
    const r = planejarLotes({
      closingDay: 10,
      submissionDays: 10,
      itens: [
        { id: 'a', execucao: '2026-03-05', defer_until: null },
        { id: 'b', execucao: '2026-03-08', defer_until: null },
        { id: 'c', execucao: '2026-03-20', defer_until: null },
        { id: 'd', execucao: '2026-03-25', defer_until: null },
      ],
      lotes: [{ id: 'l1', period_end: '2026-03-10', status: 'aberto' }],
    })
    expect(r.criar).toEqual([{ period_start: '2026-03-11', period_end: '2026-04-10', due_date: '2026-04-20' }])
    expect(r.atribuir).toEqual([
      { itemId: 'a', period_end: '2026-03-10' },
      { itemId: 'b', period_end: '2026-03-10' },
      { itemId: 'c', period_end: '2026-04-10' },
      { itemId: 'd', period_end: '2026-04-10' },
    ])
  })
  it('lote enviado desvia e cria o seguinte', () => {
    const r = planejarLotes({
      closingDay: 10,
      submissionDays: 0,
      itens: [{ id: 'a', execucao: '2026-03-05', defer_until: null }],
      lotes: [{ id: 'l1', period_end: '2026-03-10', status: 'enviado' }],
    })
    expect(r.criar).toEqual([{ period_start: '2026-03-11', period_end: '2026-04-10', due_date: '2026-04-10' }])
    expect(r.atribuir).toEqual([{ itemId: 'a', period_end: '2026-04-10' }])
  })
})

describe('atrasado / adiarAte', () => {
  it('atrasado quando execução anterior ao início do período', () => {
    expect(atrasado('2026-02-05', '2026-02-11')).toBe(true)
    expect(atrasado('2026-02-11', '2026-02-11')).toBe(false)
  })
  it('adiarAte = início do período seguinte', () => {
    expect(adiarAte('2026-03-10', 10)).toBe('2026-03-11')
  })
})
