import type { SupabaseClient } from '@supabase/supabase-js'
import { sendManual, type ManualDeps, type ManualResult } from '@/lib/messaging/manual'
import { createManualDeps } from '@/lib/messaging/manualDeps'
import { normalizeMessagingConfig } from '@/lib/messaging/config'
import { MANUAL_TEMPLATES, buildContext, renderTemplate } from '@/lib/messaging/templates'
import type { PatientRow, PaymentRow } from '@/lib/messaging/types'

const fail = (status: number, error: string): ManualResult => ({ status, body: { error } })

function check(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

const PAYMENT_COLS = 'id, patient_id, amount, due_date, status, invoice_url, provider_state'

async function findPayment(admin: SupabaseClient, clinicId: string, id: string): Promise<PaymentRow | null> {
  const { data, error } = await admin.from('payments').select(PAYMENT_COLS).eq('id', id).eq('clinic_id', clinicId).maybeSingle()
  // id que não é UUID (22P02) equivale a "não encontrado"
  if (error?.code === '22P02') return null
  check(error)
  return (data as PaymentRow | null) ?? null
}

async function deliverLink(
  admin: SupabaseClient,
  clinicId: string,
  args: { template: string; payment: PaymentRow; link: string; paymentId?: string },
  deps: ManualDeps,
): Promise<ManualResult> {
  const [patientRes, clinicRes] = await Promise.all([
    admin
      .from('patients')
      .select('id, name, phone, whatsapp, birthdate, whatsapp_opt_out')
      .eq('id', args.payment.patient_id)
      .eq('clinic_id', clinicId)
      .maybeSingle(),
    admin.from('clinics').select('name, messaging_config').eq('id', clinicId).single(),
  ])
  check(patientRes.error)
  check(clinicRes.error)
  if (!patientRes.data) return fail(404, 'Paciente não encontrado')
  const clinic = clinicRes.data as { name: string; messaging_config: unknown }
  const ctx = buildContext({
    patient: patientRes.data as PatientRow,
    clinicName: clinic.name,
    tz: normalizeMessagingConfig(clinic.messaging_config).timezone,
    payment: args.payment,
    link: args.link,
  })
  return sendManual(
    { clinicId, patient_id: args.payment.patient_id, body: renderTemplate(args.template, ctx), paymentId: args.paymentId },
    deps,
  )
}

/** Envia o link de pagamento da cobrança pelo WhatsApp (respeita opt-out, limite diário e conexão). */
export async function sendPaymentLink(
  admin: SupabaseClient,
  clinicId: string,
  paymentId: string,
  deps: ManualDeps = createManualDeps(admin),
): Promise<ManualResult> {
  const payment = await findPayment(admin, clinicId, paymentId)
  if (!payment) return fail(404, 'Pagamento não encontrado')
  if (payment.status !== 'pending' && payment.status !== 'overdue') return fail(422, 'Esta cobrança não está em aberto')
  if (!payment.invoice_url) return fail(422, 'Esta cobrança não tem link')
  return deliverLink(admin, clinicId, { template: MANUAL_TEMPLATES.payment_link, payment, link: payment.invoice_url, paymentId: payment.id }, deps)
}

/** Envia o PDF da nota fiscal pelo WhatsApp. */
export async function sendInvoiceLink(
  admin: SupabaseClient,
  clinicId: string,
  invoiceId: string,
  deps: ManualDeps = createManualDeps(admin),
): Promise<ManualResult> {
  const { data, error } = await admin
    .from('fiscal_invoices')
    .select('id, payment_id, value, pdf_url')
    .eq('id', invoiceId)
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (error?.code === '22P02') return fail(404, 'Nota não encontrada')
  check(error)
  const invoice = data as { id: string; payment_id: string; value: number; pdf_url: string | null } | null
  if (!invoice) return fail(404, 'Nota não encontrada')
  if (!invoice.pdf_url) return fail(422, 'Esta nota ainda não tem PDF')
  const payment = await findPayment(admin, clinicId, invoice.payment_id)
  if (!payment) return fail(404, 'Pagamento não encontrado')
  return deliverLink(
    admin,
    clinicId,
    { template: MANUAL_TEMPLATES.invoice, payment: { ...payment, amount: Number(invoice.value) }, link: invoice.pdf_url },
    deps,
  )
}
