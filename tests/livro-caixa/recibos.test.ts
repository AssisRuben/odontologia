import { describe, it, expect, vi } from 'vitest'
import { markReceipt, unmarkReceipt, type ReceiptDeps } from '@/lib/livro-caixa/recibos'

function makeDeps(payment: { id: string; status: string; payment_method: string | null } | null): ReceiptDeps {
  return {
    getPayment: vi.fn().mockResolvedValue(payment),
    insertReceipt: vi.fn().mockResolvedValue(undefined),
    deleteReceipt: vi.fn().mockResolvedValue(undefined),
  }
}

describe('markReceipt', () => {
  it('marks paid patient payment', async () => {
    const deps = makeDeps({ id: 'p1', status: 'paid', payment_method: 'pix' })
    const r = await markReceipt('c1', 'u1', 'p1', deps)
    expect(r).toEqual({ status: 200, body: { ok: true } })
    expect(deps.insertReceipt).toHaveBeenCalledWith({ payment_id: 'p1', clinic_id: 'c1', issued_by: 'u1' })
  })

  it('404 when payment not found', async () => {
    const deps = makeDeps(null)
    const r = await markReceipt('c1', 'u1', 'p1', deps)
    expect(r).toEqual({ status: 404, body: { error: 'Pagamento não encontrado' } })
    expect(deps.insertReceipt).not.toHaveBeenCalled()
  })

  it('422 for insurance or unpaid', async () => {
    const msg = { error: 'Este pagamento não precisa de recibo no Receita Saúde' }
    const a = makeDeps({ id: 'p1', status: 'paid', payment_method: 'convenio' })
    expect(await markReceipt('c1', 'u1', 'p1', a)).toEqual({ status: 422, body: msg })
    const b = makeDeps({ id: 'p1', status: 'pending', payment_method: 'pix' })
    expect(await markReceipt('c1', 'u1', 'p1', b)).toEqual({ status: 422, body: msg })
    expect(a.insertReceipt).not.toHaveBeenCalled()
    expect(b.insertReceipt).not.toHaveBeenCalled()
  })
})

describe('unmarkReceipt', () => {
  it('unmark deletes and returns 200', async () => {
    const deps = makeDeps({ id: 'p1', status: 'paid', payment_method: 'pix' })
    const r = await unmarkReceipt('c1', 'p1', deps)
    expect(r).toEqual({ status: 200, body: { ok: true } })
    expect(deps.deleteReceipt).toHaveBeenCalledWith('c1', 'p1')
  })

  it('unmark 404 when payment not found', async () => {
    const deps = makeDeps(null)
    const r = await unmarkReceipt('c1', 'p1', deps)
    expect(r).toEqual({ status: 404, body: { error: 'Pagamento não encontrado' } })
    expect(deps.deleteReceipt).not.toHaveBeenCalled()
  })
})
