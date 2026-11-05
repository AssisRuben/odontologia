import type { DeductionGroup } from '@/types'
import { fromDbPaidAt } from '@/lib/payments/dates'
import { normalizeCpf } from '@/lib/payments/cpf'
import { toCents } from '@/lib/payments/money'
import { toCategory } from './categorias'
import { inMonth } from './mes'

export interface LedgerPaymentIn {
  id: string
  patient_id: string
  amount: number
  net_amount: number | null
  status: string
  payment_method: string | null
  paid_at: string | null
  description: string | null
}
export interface LedgerExpenseIn {
  id: string
  description: string
  amount: number
  category: string | null
  deduction_group: string | null
  status: string
  paid_at: string | null
  receipt_path: string | null
  receipt_name: string | null
  receipt_size: number | null
}
export interface LedgerPatientIn {
  id: string
  name: string
  cpf: string | null
  payer_name: string | null
  payer_cpf: string | null
}
export interface LedgerInput {
  month: string
  payments: LedgerPaymentIn[]
  expenses: LedgerExpenseIn[]
  patients: LedgerPatientIn[]
  receipts: { payment_id: string; issued_at: string }[]
}
export type RowKind = 'receita' | 'convenio' | 'despesa' | 'tarifa'
export interface LedgerRow {
  kind: RowKind
  refId: string
  date: string
  description: string
  category: string | null
  group: DeductionGroup | null
  amountCents: number
  payerName: string | null
  payerCpf: string | null
  patientName: string | null
  receiptIssued: boolean | null
  attachmentPath: string | null
  attachmentName: string | null
  attachmentSize: number | null
}
export interface ReceiptItem {
  paymentId: string
  date: string
  amountCents: number
  payerName: string
  payerCpf: string | null
  patientId: string
  patientName: string
  patientCpf: string | null
  issuedAt: string | null
}
export interface LedgerTotals {
  patientRevenueCents: number
  insuranceRevenueCents: number
  custeioCents: number
  feesCents: number
  pessoalCents: number
  emolumentosCents: number
  deductibleCents: number
  nonDeductibleCents: number
  resultCents: number
}
export interface LedgerAlerts {
  pendingReceipts: number
  receiptsWithoutCpf: number
  deductibleWithoutAttachment: number
}
export interface Ledger {
  month: string
  totals: LedgerTotals
  rows: LedgerRow[]
  receipts: ReceiptItem[]
  alerts: LedgerAlerts
}

const KIND_ORDER: Record<RowKind, number> = { receita: 0, convenio: 1, tarifa: 2, despesa: 3 }
const MISSING_PATIENT = 'Paciente não encontrado'

function asGroup(g: string | null): DeductionGroup | null {
  return g === 'custeio' || g === 'pessoal' || g === 'emolumentos' ? g : null
}

function resolvePayer(p: LedgerPatientIn | undefined) {
  const patientName = p?.name ?? MISSING_PATIENT
  const patientCpf = normalizeCpf(p?.cpf ?? '') ?? null
  const respCpf = normalizeCpf(p?.payer_cpf ?? '') ?? null
  if (respCpf) {
    return { patientName, patientCpf, payerName: p?.payer_name?.trim() || patientName, payerCpf: respCpf }
  }
  return { patientName, patientCpf, payerName: patientName, payerCpf: patientCpf }
}

export function buildLedger(input: LedgerInput): Ledger {
  const patients = new Map(input.patients.map((p) => [p.id, p]))
  const issued = new Map(input.receipts.map((r) => [r.payment_id, r.issued_at]))
  const rows: LedgerRow[] = []
  const receipts: ReceiptItem[] = []
  const t: LedgerTotals = {
    patientRevenueCents: 0,
    insuranceRevenueCents: 0,
    custeioCents: 0,
    feesCents: 0,
    pessoalCents: 0,
    emolumentosCents: 0,
    deductibleCents: 0,
    nonDeductibleCents: 0,
    resultCents: 0,
  }
  let deductibleWithoutAttachment = 0

  for (const p of input.payments) {
    const date = fromDbPaidAt(p.paid_at)
    if (p.status !== 'paid' || !date || !inMonth(date, input.month)) continue
    const amountCents = toCents(Number(p.amount))
    const base = {
      refId: p.id,
      date,
      category: null,
      attachmentPath: null,
      attachmentName: null,
      attachmentSize: null,
    }
    const pt = patients.get(p.patient_id)

    if (p.payment_method === 'convenio') {
      t.insuranceRevenueCents += amountCents
      rows.push({
        ...base,
        kind: 'convenio',
        description: p.description || 'Recebimento de convênio',
        group: null,
        amountCents,
        payerName: null,
        payerCpf: null,
        patientName: pt?.name ?? MISSING_PATIENT,
        receiptIssued: null,
      })
      continue
    }

    t.patientRevenueCents += amountCents
    const who = resolvePayer(pt)
    const issuedAt = issued.get(p.id) ?? null
    receipts.push({
      paymentId: p.id,
      date,
      amountCents,
      payerName: who.payerName,
      payerCpf: who.payerCpf,
      patientId: p.patient_id,
      patientName: who.patientName,
      patientCpf: who.patientCpf,
      issuedAt,
    })
    rows.push({
      ...base,
      kind: 'receita',
      description: p.description || 'Pagamento',
      group: null,
      amountCents,
      payerName: who.payerName,
      payerCpf: who.payerCpf,
      patientName: who.patientName,
      receiptIssued: issuedAt !== null,
    })

    if (p.net_amount !== null && p.net_amount !== undefined) {
      const fee = amountCents - toCents(Number(p.net_amount))
      if (fee > 0) {
        t.feesCents += fee
        rows.push({
          ...base,
          kind: 'tarifa',
          description: `Tarifa de cobrança: ${p.description || 'Pagamento'}`,
          group: 'custeio',
          amountCents: fee,
          payerName: null,
          payerCpf: null,
          patientName: who.patientName,
          receiptIssued: null,
        })
      }
    }
  }

  for (const e of input.expenses) {
    const date = fromDbPaidAt(e.paid_at)
    if (e.status !== 'paid' || !date || !inMonth(date, input.month)) continue
    const amountCents = toCents(Number(e.amount))
    const group = asGroup(e.deduction_group)
    if (group === 'custeio') t.custeioCents += amountCents
    else if (group === 'pessoal') t.pessoalCents += amountCents
    else if (group === 'emolumentos') t.emolumentosCents += amountCents
    else t.nonDeductibleCents += amountCents
    if (group && !e.receipt_path) deductibleWithoutAttachment++
    rows.push({
      kind: 'despesa',
      refId: e.id,
      date,
      description: e.description,
      category: toCategory(e.category),
      group,
      amountCents,
      payerName: null,
      payerCpf: null,
      patientName: null,
      receiptIssued: null,
      attachmentPath: e.receipt_path,
      attachmentName: e.receipt_name,
      attachmentSize: e.receipt_size,
    })
  }

  t.deductibleCents = t.custeioCents + t.feesCents + t.pessoalCents + t.emolumentosCents
  t.resultCents = t.patientRevenueCents - t.deductibleCents

  rows.sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
  receipts.sort((a, b) => a.date.localeCompare(b.date))

  return {
    month: input.month,
    totals: t,
    rows,
    receipts,
    alerts: {
      pendingReceipts: receipts.filter((r) => r.issuedAt === null).length,
      receiptsWithoutCpf: receipts.filter((r) => r.payerCpf === null).length,
      deductibleWithoutAttachment,
    },
  }
}
