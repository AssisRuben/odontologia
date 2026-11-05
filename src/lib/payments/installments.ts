export const MAX_INSTALLMENTS = 12
export const MIN_INSTALLMENT_CENTS = 500

export interface Installment {
  number: number
  amountCents: number
  dueDate: string
}

const pad = (n: number) => String(n).padStart(2, '0')

function addMonthsClamped(firstDueDate: string, months: number): string {
  const [y, m, d] = firstDueDate.split('-').map(Number)
  const total = (m - 1) + months
  const year = y + Math.floor(total / 12)
  const month = (total % 12) + 1
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${year}-${pad(month)}-${pad(Math.min(d, lastDay))}`
}

export function splitInstallments(totalCents: number, count: number, firstDueDate: string): Installment[] {
  const base = Math.floor(totalCents / count)
  const remainder = totalCents - base * count
  return Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    amountCents: i === count - 1 ? base + remainder : base,
    dueDate: addMonthsClamped(firstDueDate, i),
  }))
}

export function validateChargeInput(i: {
  amountCents: number
  installmentCount: number
  firstDueDate: string
  today: string
}): string | null {
  if (!Number.isInteger(i.amountCents) || i.amountCents <= 0) return 'Informe um valor maior que zero'
  if (!Number.isInteger(i.installmentCount) || i.installmentCount < 1) return 'Mínimo de 1 parcela'
  if (i.installmentCount > MAX_INSTALLMENTS) return 'Máximo de 12 parcelas'
  if (i.firstDueDate < i.today) return 'O vencimento não pode ser no passado'
  if (Math.floor(i.amountCents / i.installmentCount) < MIN_INSTALLMENT_CENTS)
    return 'Cada parcela precisa ser de pelo menos R$ 5,00'
  return null
}
