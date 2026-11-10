import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendInvoiceLink, sendPaymentLink } from '@/lib/payments/notify'
import type { ManualDeps } from '@/lib/messaging/manual'

type Row = Record<string, unknown>

function fakeAdmin(tables: Record<string, Row[]>): SupabaseClient {
  return {
    from(table: string) {
      const filters: [string, unknown][] = []
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => { filters.push([c, v]); return q },
        maybeSingle: async () => ({
          data: (tables[table] ?? []).find((r) => filters.every(([c, v]) => r[c] === v)) ?? null,
          error: null,
        }),
        single: async () => q.maybeSingle(),
      }
      return q
    },
  } as unknown as SupabaseClient
}

const cfg = { window_start: '08:00', window_end: '20:00', daily_limit: 10, timezone: 'America/Sao_Paulo' }
function makeDeps() {
  return {
    findPatient: vi.fn<ManualDeps['findPatient']>(async () => ({ id: 'p1', whatsapp: '11987654321', phone: null, whatsapp_opt_out: false })),
    getConnection: vi.fn<ManualDeps['getConnection']>(async () => ({ instance: 'i', token: 't', status: 'connected' })),
    getConfig: vi.fn<ManualDeps['getConfig']>(async () => cfg),
    countSentToday: vi.fn<ManualDeps['countSentToday']>(async () => 0),
    deliver: vi.fn<ManualDeps['deliver']>(async () => ({ ok: true, id: 'm1' })),
  }
}

const tables = () => ({
  clinics: [{ id: 'c1', name: 'Clínica X', messaging_config: {} }],
  patients: [{ id: 'p1', clinic_id: 'c1', name: 'Maria Souza', phone: null, whatsapp: '11987654321', birthdate: null, whatsapp_opt_out: false }],
  payments: [
    { id: 'pay1', clinic_id: 'c1', patient_id: 'p1', amount: 150, due_date: '2026-11-10', status: 'pending', invoice_url: 'https://pay/1', provider_state: 'active' },
    { id: 'pay2', clinic_id: 'c1', patient_id: 'p1', amount: 150, due_date: '2026-11-10', status: 'pending', invoice_url: null, provider_state: 'active' },
    { id: 'pay3', clinic_id: 'c1', patient_id: 'p1', amount: 150, due_date: '2026-11-10', status: 'paid', invoice_url: 'https://pay/3', provider_state: 'active' },
  ],
  fiscal_invoices: [
    { id: 'inv1', clinic_id: 'c1', payment_id: 'pay1', value: 150, pdf_url: 'https://nf/1.pdf' },
    { id: 'inv2', clinic_id: 'c1', payment_id: 'pay1', value: 150, pdf_url: null },
  ],
})

describe('sendPaymentLink', () => {
  it("sendPaymentLink renders MANUAL_TEMPLATES.payment_link with valor/vencimento/link and refuses payment without invoice_url (422 'Esta cobrança não tem link')", async () => {
    const d = makeDeps()
    const ok = await sendPaymentLink(fakeAdmin(tables()), 'c1', 'pay1', d)
    expect(ok).toEqual({ status: 200, body: { id: 'm1' } })
    expect(d.deliver.mock.calls[0][1].body).toBe(
      'Olá, Maria! Segue o link para o pagamento de R$ 150,00 com vencimento em 10/11/2026: https://pay/1',
    )
    expect(d.deliver.mock.calls[0][1].payment_id).toBe('pay1')
    const no = await sendPaymentLink(fakeAdmin(tables()), 'c1', 'pay2', makeDeps())
    expect(no).toEqual({ status: 422, body: { error: 'Esta cobrança não tem link' } })
  })
  it('404 for another clinic; 422 when not open', async () => {
    expect(await sendPaymentLink(fakeAdmin(tables()), 'c2', 'pay1', makeDeps())).toEqual({ status: 404, body: { error: 'Pagamento não encontrado' } })
    expect(await sendPaymentLink(fakeAdmin(tables()), 'c1', 'pay3', makeDeps())).toEqual({ status: 422, body: { error: 'Esta cobrança não está em aberto' } })
  })
})

describe('sendInvoiceLink', () => {
  it('sends the pdf link', async () => {
    const d = makeDeps()
    expect(await sendInvoiceLink(fakeAdmin(tables()), 'c1', 'inv1', d)).toEqual({ status: 200, body: { id: 'm1' } })
    expect(d.deliver.mock.calls[0][1].body).toBe('Olá, Maria! Segue a nota fiscal do seu pagamento de R$ 150,00: https://nf/1.pdf')
    expect(d.deliver.mock.calls[0][1].payment_id).toBeNull()
  })
  it('404 other clinic, 422 without pdf', async () => {
    expect(await sendInvoiceLink(fakeAdmin(tables()), 'c2', 'inv1', makeDeps())).toEqual({ status: 404, body: { error: 'Nota não encontrada' } })
    expect(await sendInvoiceLink(fakeAdmin(tables()), 'c1', 'inv2', makeDeps())).toEqual({ status: 422, body: { error: 'Esta nota ainda não tem PDF' } })
  })
})
