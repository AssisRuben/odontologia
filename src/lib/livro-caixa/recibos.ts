export interface ReceiptDeps {
  getPayment(clinicId: string, paymentId: string): Promise<{ id: string; status: string; payment_method: string | null } | null>
  insertReceipt(row: { payment_id: string; clinic_id: string; issued_by: string }): Promise<void> // ignora duplicata (23505)
  deleteReceipt(clinicId: string, paymentId: string): Promise<void>
}

export type ReceiptResult =
  | { status: 200; body: { ok: true } }
  | { status: 404 | 422; body: { error: string } }

const NOT_FOUND: ReceiptResult = { status: 404, body: { error: 'Pagamento não encontrado' } }
const NOT_ELIGIBLE: ReceiptResult = {
  status: 422,
  body: { error: 'Este pagamento não precisa de recibo no Receita Saúde' },
}

export async function markReceipt(
  clinicId: string,
  userId: string,
  paymentId: string,
  deps: ReceiptDeps,
): Promise<ReceiptResult> {
  const payment = await deps.getPayment(clinicId, paymentId)
  if (!payment) return NOT_FOUND
  if (payment.status !== 'paid' || payment.payment_method === 'convenio') return NOT_ELIGIBLE
  await deps.insertReceipt({ payment_id: paymentId, clinic_id: clinicId, issued_by: userId })
  return { status: 200, body: { ok: true } }
}

export async function unmarkReceipt(
  clinicId: string,
  paymentId: string,
  deps: ReceiptDeps,
): Promise<ReceiptResult> {
  const payment = await deps.getPayment(clinicId, paymentId)
  if (!payment) return NOT_FOUND
  await deps.deleteReceipt(clinicId, paymentId)
  return { status: 200, body: { ok: true } }
}
