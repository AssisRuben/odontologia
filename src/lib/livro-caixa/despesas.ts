import type { DeductionGroup, ExpenseCategory } from '@/types'
import { parseReaisInput } from '@/lib/payments/money'
import { toDbPaidAt } from '@/lib/payments/dates'

export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024
export const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const

export function checkReceiptFile(f: { size: number; type: string }): string | null {
  const okType = (RECEIPT_TYPES as readonly string[]).includes(f.type)
  if (!okType || f.size > MAX_RECEIPT_BYTES) return 'Envie JPG, PNG, WEBP ou PDF de até 10 MB'
  return null
}

export interface ExpenseForm {
  description: string
  amount: string
  category: ExpenseCategory
  deductionGroup: DeductionGroup | null
  dueDate: string
  paid: boolean
  paidDate: string
  paymentMethod: string
  professionalId: string
  notes: string
}

export interface ExpenseRow {
  description: string
  amount: number
  category: ExpenseCategory
  deduction_group: DeductionGroup | null
  due_date: string | null
  status: 'pending' | 'paid'
  paid_at: string | null
  payment_method: string | null
  professional_id: string | null
  notes: string | null
}

export function validateExpense(
  f: ExpenseForm,
): { ok: true; row: ExpenseRow } | { ok: false; errors: Partial<Record<keyof ExpenseForm, string>> } {
  const errors: Partial<Record<keyof ExpenseForm, string>> = {}
  const description = f.description.trim()
  if (!description) errors.description = 'Informe a descrição'
  const cents = parseReaisInput(f.amount)
  if (cents === null || cents <= 0) errors.amount = 'Valor inválido'
  if (f.paid && !f.paidDate) errors.paidDate = 'Informe a data do pagamento'
  if (!f.paid && !f.dueDate) errors.dueDate = 'Informe o vencimento'
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    row: {
      description,
      amount: (cents as number) / 100,
      category: f.category,
      deduction_group: f.deductionGroup,
      due_date: f.dueDate || null,
      status: f.paid ? 'paid' : 'pending',
      paid_at: f.paid ? toDbPaidAt(f.paidDate) : null,
      payment_method: f.paymentMethod || null,
      professional_id: f.professionalId || null,
      notes: f.notes.trim() || null,
    },
  }
}

export function receiptStoragePath(clinicId: string, expenseId: string, fileName: string, uuid: string): string {
  const dot = fileName.lastIndexOf('.')
  const ext = dot >= 0 ? fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : ''
  return `${clinicId}/${expenseId}/${uuid}${ext ? `.${ext}` : ''}`
}
