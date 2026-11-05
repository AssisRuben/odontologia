import { describe, it, expect } from 'vitest'
import {
  MAX_RECEIPT_BYTES,
  checkReceiptFile,
  validateExpense,
  receiptStoragePath,
  type ExpenseForm,
} from '@/lib/livro-caixa/despesas'

const ERR = 'Envie JPG, PNG, WEBP ou PDF de até 10 MB'

const base: ExpenseForm = {
  description: 'Aluguel',
  amount: '1.500,50',
  category: 'aluguel',
  deductionGroup: 'custeio',
  dueDate: '2026-11-10',
  paid: false,
  paidDate: '',
  paymentMethod: '',
  professionalId: '',
  notes: '',
}

describe('checkReceiptFile', () => {
  it('rejects file over 10 MB', () => {
    expect(checkReceiptFile({ size: MAX_RECEIPT_BYTES + 1, type: 'application/pdf' })).toBe(ERR)
  })
  it('rejects gif', () => {
    expect(checkReceiptFile({ size: 100, type: 'image/gif' })).toBe(ERR)
  })
  it('accepts pdf', () => {
    expect(checkReceiptFile({ size: 100, type: 'application/pdf' })).toBeNull()
  })
  it('accepts exactly 10 MB', () => {
    expect(checkReceiptFile({ size: MAX_RECEIPT_BYTES, type: 'image/png' })).toBeNull()
  })
})

describe('validateExpense', () => {
  it('accepts a pending expense', () => {
    const r = validateExpense(base)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.row).toMatchObject({
        description: 'Aluguel', amount: 1500.5, status: 'pending', due_date: '2026-11-10',
        paid_at: null, payment_method: null, professional_id: null, notes: null, deduction_group: 'custeio',
      })
    }
  })
  it('requires description', () => {
    const r = validateExpense({ ...base, description: '  ' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.description).toBe('Informe a descrição')
  })
  it('rejects invalid and zero amount', () => {
    for (const amount of ['abc', '0', '']) {
      const r = validateExpense({ ...base, amount })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors.amount).toBe('Valor inválido')
    }
  })
  it('paid requires payment date', () => {
    const r = validateExpense({ ...base, paid: true, paidDate: '' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.paidDate).toBe('Informe a data do pagamento')
  })
  it('unpaid requires due date', () => {
    const r = validateExpense({ ...base, dueDate: '' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.dueDate).toBe('Informe o vencimento')
  })
  it('paid expense gets noon utc paid_at', () => {
    const r = validateExpense({ ...base, paid: true, paidDate: '2026-11-05', dueDate: '' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.row.paid_at).toBe('2026-11-05T12:00:00Z')
      expect(r.row.status).toBe('paid')
      expect(r.row.due_date).toBeNull()
    }
  })
})

describe('receiptStoragePath', () => {
  it('lowercases extension and uses uuid', () => {
    expect(receiptStoragePath('c1', 'e1', 'Foto Nota.JPG', 'u-1')).toBe('c1/e1/u-1.jpg')
  })
})
