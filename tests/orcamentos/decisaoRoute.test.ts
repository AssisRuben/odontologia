import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const approveBudget = vi.fn()
const rejectBudget = vi.fn()
const update = vi.fn()
let linha: { status: string; imported_from: string | null } | null = null

vi.mock('@/lib/auth/currentClinic', () => ({
  getCurrentClinic: async () => ({ clinicId: 'c1', userId: 'u1' }),
}))
vi.mock('@/lib/orcamentos/aprovacao', () => ({
  IMPORTED_READ_ONLY: 'Orçamento importado é somente leitura.',
  approveBudget: (...a: unknown[]) => approveBudget(...a),
  rejectBudget: (...a: unknown[]) => rejectBudget(...a),
}))
vi.mock('@/lib/orcamentos/repo', () => ({ createApprovalDeps: () => ({}) }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.eq = () => q
      q.update = (...a: unknown[]) => { update(...a); return q }
      q.maybeSingle = async () => ({ data: linha, error: null })
      q.insert = async () => ({ error: null })
      q.then = (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r)
      return q
    },
  }),
}))

import { POST } from '@/app/api/orcamentos/[id]/decisao/route'

const chamar = (body: unknown) => POST(
  new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as unknown as NextRequest,
  { params: Promise.resolve({ id: 'b1' }) } as never,
)

describe('POST /api/orcamentos/[id]/decisao', () => {
  beforeEach(() => { approveBudget.mockReset(); rejectBudget.mockReset(); update.mockReset() })

  it('recusa reabrir orçamento importado, sem alterar nada', async () => {
    linha = { status: 'rejected', imported_from: 'codental' }
    const res = await chamar({ action: 'reopen' })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'Orçamento importado é somente leitura.' })
    expect(update).not.toHaveBeenCalled()
  })

  it('recusa aprovar orçamento importado, sem chamar a aprovação', async () => {
    linha = { status: 'draft', imported_from: 'codental' }
    const res = await chamar({ action: 'approve', itemIds: ['i1'] })
    expect(res.status).toBe(422)
    expect(approveBudget).not.toHaveBeenCalled()
  })

  it('orçamento normal continua podendo reabrir', async () => {
    linha = { status: 'rejected', imported_from: null }
    const res = await chamar({ action: 'reopen' })
    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledTimes(1)
  })
})
