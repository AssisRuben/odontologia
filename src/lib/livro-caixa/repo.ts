import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/messaging/cycleData'
import { toDbPaidAt } from '@/lib/payments/dates'
import { monthRange } from './mes'
import type {
  LedgerExpenseIn,
  LedgerInput,
  LedgerPatientIn,
  LedgerPaymentIn,
} from './apuracao'
import type { ReceiptDeps } from './recibos'

const BUCKET = 'expense-receipts'
const BATCH = 200

function shiftDay(ymd: string, delta: number): string {
  const d = new Date(`${ymd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** Lê tudo que o livro-caixa do mês precisa (cliente do usuário, RLS + filtro por clínica). */
export async function loadLedgerInput(
  supabase: SupabaseClient,
  clinicId: string,
  month: string,
): Promise<LedgerInput> {
  const { first, last } = monthRange(month)
  // folga de 1 dia nas pontas; o filtro final por mês é feito em buildLedger
  const from = toDbPaidAt(shiftDay(first, -1))
  const to = toDbPaidAt(shiftDay(last, 1))

  const [payments, expenses] = await Promise.all([
    fetchAll<LedgerPaymentIn>((a, b) =>
      supabase
        .from('payments')
        .select('id, patient_id, amount, net_amount, status, payment_method, paid_at, description')
        .eq('clinic_id', clinicId)
        .in('status', ['paid', 'refunded'])
        .gte('paid_at', from)
        .lte('paid_at', to)
        .order('id')
        .range(a, b),
    ),
    fetchAll<LedgerExpenseIn>((a, b) =>
      supabase
        .from('expenses')
        .select('id, description, amount, category, deduction_group, status, paid_at, receipt_path, receipt_name, receipt_size')
        .eq('clinic_id', clinicId)
        .eq('status', 'paid')
        .gte('paid_at', from)
        .lte('paid_at', to)
        .order('id')
        .range(a, b),
    ),
  ])

  const patientIds = [...new Set(payments.map((p) => p.patient_id).filter(Boolean))]
  const paymentIds = payments.map((p) => p.id)

  const patients: LedgerPatientIn[] = []
  for (const ids of chunk(patientIds, BATCH)) {
    const { data, error } = await supabase
      .from('patients')
      .select('id, name, cpf, payer_name, payer_cpf')
      .eq('clinic_id', clinicId)
      .in('id', ids)
    if (error) throw new Error(error.message)
    patients.push(...((data ?? []) as LedgerPatientIn[]))
  }

  const receipts: { payment_id: string; issued_at: string }[] = []
  for (const ids of chunk(paymentIds, BATCH)) {
    const { data, error } = await supabase
      .from('health_receipts')
      .select('payment_id, issued_at')
      .eq('clinic_id', clinicId)
      .in('payment_id', ids)
    if (error) throw new Error(error.message)
    receipts.push(...((data ?? []) as { payment_id: string; issued_at: string }[]))
  }

  return { month, payments, expenses, patients, receipts }
}

export async function loadClinicName(supabase: SupabaseClient, clinicId: string): Promise<string> {
  const { data, error } = await supabase.from('clinics').select('name').eq('id', clinicId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data?.name as string | undefined) ?? 'Clínica'
}

export async function downloadAttachment(supabase: SupabaseClient, path: string): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error || !data) throw new Error(error?.message ?? 'Falha ao baixar o comprovante')
  return new Uint8Array(await data.arrayBuffer())
}

export function createReceiptDeps(supabase: SupabaseClient): ReceiptDeps {
  return {
    async getPayment(clinicId, paymentId) {
      const { data, error } = await supabase
        .from('payments')
        .select('id, status, payment_method')
        .eq('id', paymentId)
        .eq('clinic_id', clinicId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data as { id: string; status: string; payment_method: string | null } | null) ?? null
    },
    async insertReceipt(row) {
      const { error } = await supabase.from('health_receipts').insert(row)
      if (error && error.code !== '23505') throw new Error(error.message)
    },
    async deleteReceipt(clinicId, paymentId) {
      const { error } = await supabase
        .from('health_receipts')
        .delete()
        .eq('clinic_id', clinicId)
        .eq('payment_id', paymentId)
      if (error) throw new Error(error.message)
    },
  }
}
