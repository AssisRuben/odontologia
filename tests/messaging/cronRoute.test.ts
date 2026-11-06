import { describe, it, expect, vi, beforeEach } from 'vitest'

const expireBudgets = vi.fn()
const runCycle = vi.fn()
vi.mock('@/lib/orcamentos/aprovacao', () => ({ expireBudgets: (...a: unknown[]) => expireBudgets(...a) }))
vi.mock('@/lib/orcamentos/repo', () => ({ createApprovalDeps: () => ({ deps: true }) }))
vi.mock('@/lib/messaging/cycle', () => ({ runCycle: (...a: unknown[]) => runCycle(...a) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/whatsapp', () => ({ getProvider: () => ({}) }))
vi.mock('@/lib/auth/cronAuth', () => ({ authorized: () => true }))

import { POST } from '@/app/api/cron/messages/route'

describe('cron/messages', () => {
  beforeEach(() => { expireBudgets.mockReset(); runCycle.mockReset().mockResolvedValue({}) })
  it('chama expireBudgets uma vez por execução', async () => {
    await POST(new Request('http://x', { method: 'POST' }))
    expect(expireBudgets).toHaveBeenCalledTimes(1)
    expect(runCycle).toHaveBeenCalledTimes(1)
  })
  it('falha no vencimento não impede o envio', async () => {
    expireBudgets.mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(new Request('http://x', { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(runCycle).toHaveBeenCalledTimes(1)
  })
})
