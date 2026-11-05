import { describe, it, expect, vi, type MockedObject } from 'vitest'
import { approveBudget, rejectBudget, expireBudgets, type ApprovalDeps } from '@/lib/orcamentos/aprovacao'

const items = [
  { id: 'i1', procedure: 'Limpeza', tooth: null, quantity: 2, unit_price: 150 },
  { id: 'i2', procedure: 'Restauração', tooth: '16', quantity: 1, unit_price: 89.9 },
  { id: 'i3', procedure: 'Canal', tooth: '11', quantity: 1, unit_price: 800 },
]

function deps(over: Partial<ApprovalDeps> = {}) {
  return {
    loadForApproval: vi.fn(async () => ({
      budget: { id: 'b1', created_at: '2026-11-01T00:00:00Z', valid_until: '2026-12-01' },
      clinicName: 'Clínica', patientName: 'Maria', professionalName: 'Dr. A', items,
    })),
    actorName: vi.fn(async () => 'Recepcionista Ana'),
    rpcApprove: vi.fn(async () => 'ok' as const),
    rpcReject: vi.fn(async () => 'ok' as const),
    listSent: vi.fn(async () => []),
    ...over,
  } as unknown as MockedObject<ApprovalDeps>
}

const base = {
  budgetId: 'b1', clinicId: 'c1', linkId: 'l1', itemIds: ['i1', 'i2'],
  signer: { name: 'Maria Silva', cpf: '12345678909' }, actorId: null, ip: '1.1.1.1', userAgent: 'UA',
  now: new Date('2026-11-05T12:00:00Z'),
}

describe('approveBudget', () => {
  it('sem itens -> 422', async () => {
    const d = deps()
    expect(await approveBudget({ ...base, itemIds: [] }, d)).toEqual({ ok: false, status: 422, error: 'Selecione ao menos um item' })
    expect(d.rpcApprove).not.toHaveBeenCalled()
  })
  it('item de outro orçamento -> 422', async () => {
    const d = deps()
    const r = await approveBudget({ ...base, itemIds: ['i1', 'zzz'] }, d)
    expect(r).toMatchObject({ ok: false, status: 422 })
    expect(d.rpcApprove).not.toHaveBeenCalled()
  })
  it('orçamento inexistente -> 404', async () => {
    const d = deps({ loadForApproval: vi.fn(async () => null) })
    expect(await approveBudget(base, d)).toEqual({ ok: false, status: 404, error: 'Orçamento não encontrado' })
  })
  it('total aprovado de 2 itens = 389,90 e assinatura do app', async () => {
    const d = deps()
    expect(await approveBudget(base, d)).toEqual({ ok: true })
    const args = d.rpcApprove.mock.calls[0]
    expect(args[0]).toBe('b1'); expect(args[1]).toBe('l1'); expect(args[2]).toEqual(['i1', 'i2'])
    expect(args[3]).toBe(389.9)
    const sig = args[4]
    expect(sig).toMatchObject({
      provider: 'app', provider_ref: null, signer_name: 'Maria Silva', signer_cpf: '12345678909',
      ip: '1.1.1.1', user_agent: 'UA', signed_at: '2026-11-05T12:00:00.000Z', approved_by: null,
    })
    expect(sig.document_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(sig.snapshot.total_aprovado).toBe('389.90')
    expect(args[5]).toBeNull()
  })
  it('recepção grava provider reception e nome do usuário', async () => {
    const d = deps()
    await approveBudget({ ...base, linkId: null, signer: null, actorId: 'u1' }, d)
    const args = d.rpcApprove.mock.calls[0]
    expect(args[1]).toBeNull()
    expect(args[4]).toMatchObject({ provider: 'reception', signer_name: 'Recepcionista Ana', signer_cpf: '', approved_by: 'u1' })
    expect(args[4].snapshot.assinante).toEqual({ nome: 'Recepcionista Ana', cpf: '' })
    expect(args[5]).toBe('u1')
  })
  it('second approval is rejected', async () => {
    const d = deps({ rpcApprove: vi.fn(async () => 'already_decided' as const) })
    expect(await approveBudget(base, d)).toEqual({ ok: false, status: 409, error: 'Este orçamento já foi respondido.' })
  })
  it('not_found do RPC -> 404', async () => {
    const d = deps({ rpcApprove: vi.fn(async () => 'not_found' as const) })
    expect(await approveBudget(base, d)).toEqual({ ok: false, status: 404, error: 'Orçamento não encontrado' })
  })
})

describe('rejectBudget', () => {
  const rb = { budgetId: 'b1', clinicId: 'c1', linkId: 'l1', reason: null, note: null, actorId: null, status: 'rejected' as const }
  it('recepção sem motivo -> 422', async () => {
    const d = deps()
    expect(await rejectBudget({ ...rb, linkId: null, actorId: 'u1' }, d)).toEqual({ ok: false, status: 422, error: 'Escolha o motivo' })
    expect(d.rpcReject).not.toHaveBeenCalled()
  })
  it('paciente sem motivo passa (banco grava outro)', async () => {
    const d = deps()
    expect(await rejectBudget(rb, d)).toEqual({ ok: true })
    expect(d.rpcReject).toHaveBeenCalledWith('b1', 'l1', null, null, null, 'rejected')
  })
  it('recepção com motivo', async () => {
    const d = deps()
    await rejectBudget({ ...rb, linkId: null, actorId: 'u1', reason: 'preco', note: 'caro' }, d)
    expect(d.rpcReject).toHaveBeenCalledWith('b1', null, 'preco', 'caro', 'u1', 'rejected')
  })
  it('already_decided -> 409', async () => {
    const d = deps({ rpcReject: vi.fn(async () => 'already_decided' as const) })
    expect(await rejectBudget(rb, d)).toEqual({ ok: false, status: 409, error: 'Este orçamento já foi respondido.' })
  })
  it('not_found -> 404', async () => {
    const d = deps({ rpcReject: vi.fn(async () => 'not_found' as const) })
    expect(await rejectBudget(rb, d)).toMatchObject({ ok: false, status: 404 })
  })
})

describe('expireBudgets', () => {
  it('só vencidos (antes de hoje em São Paulo) e sent', async () => {
    const d = deps({
      listSent: vi.fn(async () => [
        { id: 'a', status: 'sent', valid_until: '2026-11-04' },
        { id: 'b', status: 'sent', valid_until: '2026-11-05' },
        { id: 'c', status: 'sent', valid_until: null },
        { id: 'd', status: 'draft', valid_until: '2026-10-01' },
      ]),
    })
    // 2026-11-06T01:00Z = 05/11 22:00 em São Paulo
    const n = await expireBudgets(new Date('2026-11-06T01:00:00Z'), d)
    expect(n).toBe(1)
    expect(d.rpcReject).toHaveBeenCalledTimes(1)
    expect(d.rpcReject).toHaveBeenCalledWith('a', null, 'sem_resposta', null, null, 'expired')
  })
  it('não conta quem já foi decidido', async () => {
    const d = deps({
      listSent: vi.fn(async () => [{ id: 'a', status: 'sent', valid_until: '2026-01-01' }]),
      rpcReject: vi.fn(async () => 'already_decided' as const),
    })
    expect(await expireBudgets(new Date('2026-11-06T01:00:00Z'), d)).toBe(0)
  })
})
