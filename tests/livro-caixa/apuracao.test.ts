import { describe, it, expect } from 'vitest'
import {
  buildLedger,
  type LedgerExpenseIn,
  type LedgerInput,
  type LedgerPatientIn,
  type LedgerPaymentIn,
} from '@/lib/livro-caixa/apuracao'

const MONTH = '2026-11'

function pay(o: Partial<LedgerPaymentIn> = {}): LedgerPaymentIn {
  return {
    id: 'p1',
    patient_id: 'pt1',
    amount: 100,
    net_amount: null,
    status: 'paid',
    payment_method: 'pix',
    paid_at: '2026-11-10T12:00:00+00:00',
    description: null,
    ...o,
  }
}
function exp(o: Partial<LedgerExpenseIn> = {}): LedgerExpenseIn {
  return {
    id: 'e1',
    description: 'Despesa',
    amount: 50,
    category: 'material',
    deduction_group: 'custeio',
    status: 'paid',
    paid_at: '2026-11-12T12:00:00+00:00',
    receipt_path: 'a/b.pdf',
    receipt_name: 'b.pdf',
    receipt_size: 10,
    ...o,
  }
}
function pat(o: Partial<LedgerPatientIn> = {}): LedgerPatientIn {
  return { id: 'pt1', name: 'Maria', cpf: '529.982.247-25', payer_name: null, payer_cpf: null, ...o }
}
function run(o: Partial<LedgerInput> = {}) {
  return buildLedger({ month: MONTH, payments: [], expenses: [], patients: [pat()], receipts: [], ...o })
}

describe('buildLedger', () => {
  it('counts paid payments by paid_at date', () => {
    const l = run({
      payments: [
        pay({ id: 'a', paid_at: '2026-11-30T12:00:00+00:00' }),
        pay({ id: 'b', paid_at: '2026-12-01T12:00:00+00:00' }),
        pay({ id: 'c', paid_at: '2026-10-31T12:00:00+00:00' }),
      ],
    })
    expect(l.totals.patientRevenueCents).toBe(10000)
    expect(l.receipts.map((r) => r.paymentId)).toEqual(['a'])
  })

  it('excludes pending, overdue, cancelled and refunded', () => {
    const l = run({
      payments: ['pending', 'overdue', 'cancelled', 'refunded'].map((s, i) => pay({ id: `x${i}`, status: s })),
    })
    expect(l.totals.patientRevenueCents).toBe(0)
    expect(l.rows).toHaveLength(0)
  })

  it('refunded payment with issued receipt is excluded', () => {
    const l = run({
      payments: [pay({ status: 'refunded' })],
      receipts: [{ payment_id: 'p1', issued_at: '2026-11-11' }],
    })
    expect(l.receipts).toHaveLength(0)
    expect(l.totals.patientRevenueCents).toBe(0)
  })

  it('separates insurance revenue', () => {
    const l = run({ payments: [pay({ payment_method: 'convenio', amount: 80 }), pay({ id: 'p2' })] })
    expect(l.totals.insuranceRevenueCents).toBe(8000)
    expect(l.totals.patientRevenueCents).toBe(10000)
    expect(l.totals.resultCents).toBe(10000)
    expect(l.receipts.map((r) => r.paymentId)).toEqual(['p2'])
    expect(l.rows.find((r) => r.kind === 'convenio')?.amountCents).toBe(8000)
  })

  it('fees from net_amount', () => {
    const l = run({ payments: [pay({ amount: 10, net_amount: 9.01 })] })
    expect(l.totals.feesCents).toBe(99)
    const tarifa = l.rows.find((r) => r.kind === 'tarifa')!
    expect(tarifa.group).toBe('custeio')
    expect(tarifa.description).toBe('Tarifa de cobrança: Pagamento')
    expect(l.totals.custeioCents).toBe(0)
    expect(run({ payments: [pay({ net_amount: null })] }).totals.feesCents).toBe(0)
    expect(run({ payments: [pay({ amount: 10, net_amount: 10 })] }).totals.feesCents).toBe(0)
    expect(run({ payments: [pay({ amount: 10, net_amount: 11 })] }).totals.feesCents).toBe(0)
    const named = run({ payments: [pay({ amount: 10, net_amount: 9, description: 'Limpeza' })] })
    expect(named.rows.find((r) => r.kind === 'tarifa')!.description).toBe('Tarifa de cobrança: Limpeza')
  })

  it('groups expenses and respects override', () => {
    const l = run({
      expenses: [
        exp({ id: '1', category: 'aluguel', deduction_group: 'custeio', amount: 100 }),
        exp({ id: '2', category: 'material', deduction_group: null, amount: 30 }),
        exp({ id: '3', category: 'salarios', deduction_group: 'pessoal', amount: 200 }),
        exp({ id: '4', category: 'emolumentos', deduction_group: 'emolumentos', amount: 20 }),
      ],
    })
    expect(l.totals.custeioCents).toBe(10000)
    expect(l.totals.nonDeductibleCents).toBe(3000)
    expect(l.totals.pessoalCents).toBe(20000)
    expect(l.totals.emolumentosCents).toBe(2000)
    expect(l.totals.deductibleCents).toBe(32000)
  })

  it('treats invalid deduction_group as non-deductible', () => {
    const l = run({ expenses: [exp({ deduction_group: 'xyz' })] })
    expect(l.totals.nonDeductibleCents).toBe(5000)
    expect(l.rows[0].group).toBeNull()
  })

  it('unknown category falls back to outras', () => {
    const l = run({ expenses: [exp({ category: 'Material antigo', deduction_group: null, amount: 40 })] })
    expect(l.totals.nonDeductibleCents).toBe(4000)
    expect(l.rows[0].category).toBe('outras')
  })

  it('unpaid expense is ignored', () => {
    const l = run({ expenses: [exp({ status: 'pending' }), exp({ id: 'e2', paid_at: '2026-12-01T12:00:00+00:00' })] })
    expect(l.rows).toHaveLength(0)
    expect(l.totals.custeioCents).toBe(0)
  })

  it('negative result is kept', () => {
    const l = run({ payments: [pay({ amount: 10 })], expenses: [exp({ amount: 100 })] })
    expect(l.totals.resultCents).toBe(-9000)
  })

  it('sums in cents without float drift', () => {
    const l = run({
      payments: [pay({ id: 'a', amount: 0.1 }), pay({ id: 'b', amount: 0.2 }), pay({ id: 'c', amount: 0.3 })],
    })
    expect(l.totals.patientRevenueCents).toBe(60)
  })

  it('tolerates numeric strings', () => {
    const l = run({ payments: [pay({ amount: '12.50' as unknown as number })] })
    expect(l.totals.patientRevenueCents).toBe(1250)
  })

  it('payer is responsible when payer_cpf is valid, else patient', () => {
    const l = run({
      patients: [pat({ payer_name: 'João', payer_cpf: '111.444.777-35' })],
      payments: [pay()],
    })
    expect(l.receipts[0]).toMatchObject({
      payerName: 'João',
      payerCpf: '11144477735',
      patientName: 'Maria',
      patientCpf: '52998224725',
    })
    const l2 = run({ patients: [pat({ payer_name: 'João', payer_cpf: null })], payments: [pay()] })
    expect(l2.receipts[0]).toMatchObject({ payerName: 'Maria', payerCpf: '52998224725' })
  })

  it('uses patient name when payer_cpf is valid but payer_name is empty', () => {
    const l = run({ patients: [pat({ payer_name: '', payer_cpf: '11144477735' })], payments: [pay()] })
    expect(l.receipts[0]).toMatchObject({ payerName: 'Maria', payerCpf: '11144477735' })
  })

  it('normalizes formatted payer cpf', () => {
    const l = run({
      patients: [pat({ cpf: null, payer_name: 'Ana', payer_cpf: '529.982.247-25' })],
      payments: [pay()],
    })
    expect(l.receipts[0].payerCpf).toBe('52998224725')
  })

  it('invalid cpf counts as missing', () => {
    const l = run({ patients: [pat({ cpf: null, payer_cpf: '111.111.111-11' })], payments: [pay()] })
    expect(l.receipts[0].payerCpf).toBeNull()
    expect(l.alerts.receiptsWithoutCpf).toBe(1)
    const l2 = run({ patients: [pat({ payer_name: 'X', payer_cpf: '111.111.111-11' })], payments: [pay()] })
    expect(l2.receipts[0]).toMatchObject({ payerName: 'Maria', payerCpf: '52998224725' })
    expect(l2.alerts.receiptsWithoutCpf).toBe(0)
  })

  it('missing patient yields placeholder name', () => {
    const l = run({ patients: [], payments: [pay()] })
    expect(l.receipts[0]).toMatchObject({
      patientName: 'Paciente não encontrado',
      patientCpf: null,
      payerCpf: null,
    })
  })

  it('issued receipts carry issuedAt and lower pendingReceipts', () => {
    const l = run({
      payments: [pay({ id: 'a' }), pay({ id: 'b' })],
      receipts: [{ payment_id: 'a', issued_at: '2026-11-15' }],
    })
    expect(l.receipts.find((r) => r.paymentId === 'a')!.issuedAt).toBe('2026-11-15')
    expect(l.alerts.pendingReceipts).toBe(1)
    expect(l.rows.find((r) => r.refId === 'a')!.receiptIssued).toBe(true)
  })

  it('deductible expense without attachment raises alert', () => {
    const l = run({
      expenses: [
        exp({ id: '1', receipt_path: null }),
        exp({ id: '2', receipt_path: null, deduction_group: null }),
        exp({ id: '3' }),
      ],
    })
    expect(l.alerts.deductibleWithoutAttachment).toBe(1)
  })

  it('orders rows by date then kind', () => {
    const l = run({
      payments: [
        pay({ id: 'a', paid_at: '2026-11-10T12:00:00Z', net_amount: 9 }),
        pay({ id: 'b', paid_at: '2026-11-10T12:00:00Z', payment_method: 'convenio' }),
      ],
      expenses: [exp({ paid_at: '2026-11-10T12:00:00Z' }), exp({ id: 'e0', paid_at: '2026-11-02T12:00:00Z' })],
    })
    expect(l.rows.map((r) => r.kind)).toEqual(['despesa', 'receita', 'convenio', 'tarifa', 'despesa'])
  })
})
