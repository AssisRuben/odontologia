import { describe, it, expect } from 'vitest'
import { statusExibido } from './statusExibido'

describe('statusExibido', () => {
  const hoje = '2026-11-10'
  it('pendente vencido ontem vira overdue', () => {
    expect(statusExibido({ status: 'pending', due_date: '2026-11-09' }, hoje)).toBe('overdue')
  })
  it('pendente vencendo hoje continua pending', () => {
    expect(statusExibido({ status: 'pending', due_date: '2026-11-10' }, hoje)).toBe('pending')
  })
  it('pendente sem vencimento continua pending', () => {
    expect(statusExibido({ status: 'pending', due_date: null }, hoje)).toBe('pending')
  })
  it('pago continua paid', () => {
    expect(statusExibido({ status: 'paid', due_date: '2026-01-01' }, hoje)).toBe('paid')
  })
})
