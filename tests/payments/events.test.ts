import { describe, expect, it, vi } from 'vitest'
import { handleWebhook, reprocessEvent, type EventDeps, type EventPayment } from '@/lib/payments/events'
import { parseAsaasWebhook } from '@/lib/payments/asaas'

const NOW = new Date('2027-01-10T15:00:00Z')

function chargeBody(event: string, over: Record<string, unknown> = {}, id = 'evt_1') {
  return {
    id,
    event,
    payment: {
      id: 'pay_1', status: 'RECEIVED', value: 100, netValue: 96.5, dueDate: '2027-01-20',
      paymentDate: '2027-01-09', deleted: false, ...over,
    },
  }
}

function invoiceBody(event: string, over: Record<string, unknown> = {}, id = 'evt_i') {
  return { id, event, invoice: { id: 'inv_1', status: 'AUTHORIZED', number: '123', pdfUrl: 'p', xmlUrl: 'x', ...over } }
}

function makeDeps(opts: {
  rows?: Partial<EventPayment>[]
  nfseAuto?: boolean
  invoices?: { paymentId: string; status: string }[]
  scheduleError?: Error
  updateError?: Error
} = {}) {
  const rows: EventPayment[] = (opts.rows ?? [{}]).map((r, i) => ({
    id: `p${i + 1}`, providerChargeId: `pay_${i + 1}`, status: 'pending', dueDate: '2027-01-20',
    amountCents: 10000, paidAt: null, netAmountCents: null, hasAuthorizedInvoice: false, chargeKind: 'avulsa',
    chargeGroupId: null, installmentNumber: null, ...r,
  }))
  const events = new Map<string, { id: string; status: string; error: string | null }>()
  const invoices = [...(opts.invoices ?? [])]
  const updates: { id: string; patch: Record<string, unknown> }[] = []
  const invoiceUpdates: { id: string; patch: Record<string, unknown> }[] = []
  const deps = {
    findClinicByToken: vi.fn<EventDeps['findClinicByToken']>(async (t) =>
      t === 'tok' ? { clinicId: 'c1', nfseAuto: opts.nfseAuto ?? false } : null),
    getNfseAuto: vi.fn<EventDeps['getNfseAuto']>(async () => opts.nfseAuto ?? false),
    insertEvent: vi.fn<EventDeps['insertEvent']>(async (e) => {
      if (events.has(e.providerEventId)) return null
      const rec = { id: `ev_${events.size + 1}`, status: e.status, error: e.error }
      events.set(e.providerEventId, rec)
      return { id: rec.id }
    }),
    finishEvent: vi.fn<EventDeps['finishEvent']>(async (_c, id, status, error) => {
      for (const e of events.values()) if (e.id === id) Object.assign(e, { status, error })
    }),
    findPayment: vi.fn<EventDeps['findPayment']>(async (_c, chargeId) =>
      rows.find((r) => r.providerChargeId === chargeId) ?? null),
    updatePayment: vi.fn<EventDeps['updatePayment']>(async (_c, id, patch) => {
      if (opts.updateError) throw opts.updateError
      updates.push({ id, patch: patch as Record<string, unknown> })
      const row = rows.find((r) => r.id === id)!
      if (patch.status) row.status = patch.status
    }),
    listGroup: vi.fn<EventDeps['listGroup']>(async (_c, g) =>
      rows.filter((r) => r.chargeGroupId === g).map((r) => ({ id: r.id, installmentNumber: r.installmentNumber, amountCents: r.amountCents }))),
    hasInvoice: vi.fn<EventDeps['hasInvoice']>(async (_c, ids, statuses) =>
      invoices.some((i) => ids.includes(i.paymentId) && (statuses === 'any' || statuses.includes(i.status as never)))),
    scheduleInvoice: vi.fn<EventDeps['scheduleInvoice']>(async (_c, paymentId) => {
      if (opts.scheduleError) throw opts.scheduleError
      invoices.push({ paymentId, status: 'scheduled' })
    }),
    updateInvoice: vi.fn<EventDeps['updateInvoice']>(async (_c, id, patch) => {
      if (id !== 'inv_1') return false
      invoiceUpdates.push({ id, patch: { ...patch } })
      return true
    }),
    today: vi.fn<EventDeps['today']>(async () => '2027-01-10'),
  }
  return { deps: deps as EventDeps & typeof deps, events, updates, invoiceUpdates }
}

describe('handleWebhook', () => {
  it('unknown or missing token → 401', async () => {
    const { deps } = makeDeps()
    expect(await handleWebhook(null, chargeBody('PAYMENT_RECEIVED'), deps, NOW)).toMatchObject({ status: 401 })
    expect(await handleWebhook('nope', chargeBody('PAYMENT_RECEIVED'), deps, NOW)).toMatchObject({ status: 401 })
    expect(deps.insertEvent).not.toHaveBeenCalled()
  })

  it('invalid body with valid token → 200 ignored', async () => {
    const { deps } = makeDeps()
    expect(await handleWebhook('tok', undefined, deps, NOW)).toEqual({ status: 200, result: 'ignored' })
  })

  it('duplicate provider_event_id is a no-op', async () => {
    const { deps, updates } = makeDeps()
    await handleWebhook('tok', chargeBody('PAYMENT_RECEIVED'), deps, NOW)
    const r = await handleWebhook('tok', chargeBody('PAYMENT_RECEIVED'), deps, NOW)
    expect(r).toEqual({ status: 200, result: 'duplicate' })
    expect(updates).toHaveLength(1)
  })

  it('PAYMENT_RECEIVED marks paid and stores net_amount', async () => {
    const { deps, updates, events } = makeDeps()
    const r = await handleWebhook('tok', chargeBody('PAYMENT_RECEIVED'), deps, NOW)
    expect(r).toEqual({ status: 200, result: 'processed' })
    expect(updates[0].patch).toMatchObject({ status: 'paid', paid_at: '2027-01-09', net_amount_cents: 9650 })
    expect(events.get('evt_1')?.status).toBe('processed')
  })

  it('unknown charge id → ignored', async () => {
    const { deps, updates, events } = makeDeps()
    const r = await handleWebhook('tok', chargeBody('PAYMENT_RECEIVED', { id: 'pay_x' }), deps, NOW)
    expect(r).toEqual({ status: 200, result: 'ignored' })
    expect(updates).toHaveLength(0)
    expect(events.get('evt_1')?.status).toBe('ignored')
  })

  it('processing error → event failed with error and status 200', async () => {
    const { deps, events } = makeDeps({ updateError: new Error('db caiu') })
    const r = await handleWebhook('tok', chargeBody('PAYMENT_RECEIVED'), deps, NOW)
    expect(r).toEqual({ status: 200, result: 'failed' })
    expect(events.get('evt_1')).toMatchObject({ status: 'failed', error: 'db caiu' })
  })

  it('nfse_auto schedules invoice on becamePaid', async () => {
    const { deps } = makeDeps({ nfseAuto: true })
    await handleWebhook('tok', chargeBody('PAYMENT_RECEIVED'), deps, NOW)
    expect(deps.scheduleInvoice).toHaveBeenCalledWith('c1', 'p1', {})
  })

  it('nfse_auto off does not schedule', async () => {
    const { deps } = makeDeps({ nfseAuto: false })
    await handleWebhook('tok', chargeBody('PAYMENT_RECEIVED'), deps, NOW)
    expect(deps.scheduleInvoice).not.toHaveBeenCalled()
  })

  it('invoice scheduling failure keeps the payment update and marks the event failed', async () => {
    const { deps, updates, events } = makeDeps({ nfseAuto: true, scheduleError: new Error('NFS-e indisponível') })
    const r = await handleWebhook('tok', chargeBody('PAYMENT_RECEIVED'), deps, NOW)
    expect(r.result).toBe('failed')
    expect(updates).toHaveLength(1)
    expect(events.get('evt_1')).toMatchObject({ status: 'failed', error: 'NFS-e indisponível' })
  })

  it('card installment schedules one invoice for the group', async () => {
    const group = { chargeKind: 'cartao_parcelado' as const, chargeGroupId: 'g1', amountCents: 5000 }
    const { deps } = makeDeps({
      nfseAuto: true,
      rows: [
        { ...group, installmentNumber: 1 },
        { ...group, installmentNumber: 2 },
        { ...group, installmentNumber: 3 },
      ],
    })
    await handleWebhook('tok', chargeBody('PAYMENT_CONFIRMED', { id: 'pay_2' }, 'e2'), deps, NOW)
    await handleWebhook('tok', chargeBody('PAYMENT_CONFIRMED', { id: 'pay_3' }, 'e3'), deps, NOW)
    await handleWebhook('tok', chargeBody('PAYMENT_CONFIRMED', { id: 'pay_1' }, 'e1'), deps, NOW)
    expect(deps.scheduleInvoice).toHaveBeenCalledTimes(1)
    expect(deps.scheduleInvoice).toHaveBeenCalledWith('c1', 'p1', { valueCents: 15000 })
  })

  it('INVOICE_AUTHORIZED updates invoice number/pdf/xml', async () => {
    const { deps, invoiceUpdates } = makeDeps()
    const r = await handleWebhook('tok', invoiceBody('INVOICE_AUTHORIZED'), deps, NOW)
    expect(r.result).toBe('processed')
    expect(invoiceUpdates[0].patch).toEqual({ status: 'authorized', number: '123', pdf_url: 'p', xml_url: 'x', error: null })
  })

  it('INVOICE_ERROR stores reason', async () => {
    const { deps, invoiceUpdates } = makeDeps()
    await handleWebhook('tok', invoiceBody('INVOICE_ERROR', { status: 'ERROR', statusDescription: 'CNAE inválido' }), deps, NOW)
    expect(invoiceUpdates[0].patch).toEqual({ status: 'error', error: 'CNAE inválido' })
  })

  it('INVOICE_CANCELLATION_DENIED returns to authorized', async () => {
    const { deps, invoiceUpdates } = makeDeps()
    await handleWebhook('tok', invoiceBody('INVOICE_CANCELLATION_DENIED', { status: 'CANCELLATION_DENIED', statusDescription: 'Prazo expirado' }), deps, NOW)
    expect(invoiceUpdates[0].patch).toEqual({ status: 'authorized', error: 'Prazo expirado' })
  })

  it('unknown invoice id and other INVOICE_* are ignored', async () => {
    const { deps } = makeDeps()
    expect(await handleWebhook('tok', invoiceBody('INVOICE_AUTHORIZED', { id: 'zzz' }, 'a'), deps, NOW)).toMatchObject({ result: 'ignored' })
    expect(await handleWebhook('tok', invoiceBody('INVOICE_CREATED', {}, 'b'), deps, NOW)).toMatchObject({ result: 'ignored' })
  })

  it('REFUNDED with authorized invoice sets alert', async () => {
    const { deps, updates } = makeDeps({ rows: [{ status: 'paid', hasAuthorizedInvoice: true }] })
    await handleWebhook('tok', chargeBody('PAYMENT_REFUNDED', { status: 'REFUNDED' }), deps, NOW)
    expect(updates[0].patch).toMatchObject({ status: 'refunded', alert: 'refunded_with_invoice' })
  })
})

describe('reprocessEvent', () => {
  it('re-applies a failed event and schedules the missing invoice', async () => {
    const { deps } = makeDeps({ nfseAuto: true, rows: [{ status: 'paid', paidAt: '2027-01-09', netAmountCents: 9650 }] })
    const r = await reprocessEvent({ id: 'ev_9', clinic_id: 'c1', payload: chargeBody('PAYMENT_RECEIVED') }, deps, NOW)
    expect(r).toBe('processed')
    expect(deps.scheduleInvoice).toHaveBeenCalledWith('c1', 'p1', {})
    expect(deps.finishEvent).toHaveBeenCalledWith('c1', 'ev_9', 'processed', null)
  })
})

describe('parseAsaasWebhook', () => {
  it('is exported standalone', () => {
    expect(parseAsaasWebhook(chargeBody('PAYMENT_RECEIVED'))?.charge?.id).toBe('pay_1')
  })
})
