import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeAdmin, type Query } from '../fakeSupabase'

const CLINIC = '00000000-0000-4000-8000-0000000000c1'
const ID = '33333333-3333-4333-8333-333333333333'
const LOTE = '44444444-4444-4444-8444-444444444444'

let resolver: (q: Query) => unknown = () => ({ data: [], error: null })
let queriesVistas: Query[] = []
const rpc = vi.fn()

vi.mock('@/lib/auth/currentClinic', () => ({
  getCurrentClinic: async () => ({ clinicId: CLINIC, userId: 'u1' }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    const f = fakeAdmin((q) => {
      queriesVistas.push(q)
      return resolver(q)
    })
    return { ...f.admin, rpc }
  },
}))

import { GET as listar, POST as criar } from '@/app/api/estoque/route'
import { PATCH as editar } from '@/app/api/estoque/[id]/route'
import { POST as entrada } from '@/app/api/estoque/[id]/entrada/route'
import { POST as saida } from '@/app/api/estoque/[id]/saida/route'
import { POST as contagem } from '@/app/api/estoque/[id]/contagem/route'
import { POST as vencido } from '@/app/api/estoque/lotes/[loteId]/vencido/route'
import { GET as movimentos } from '@/app/api/estoque/movimentos/route'

const ok = (data: unknown) => ({ data, error: null })
const req = (method: string, body?: unknown, qs = '') =>
  new Request(`http://x/api/estoque${qs}`, { method, body: body === undefined ? undefined : JSON.stringify(body) }) as never
const reqRaw = (method: string, raw: string) => new Request('http://x/api/estoque', { method, body: raw }) as never
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never
const ctxLote = (loteId: string) => ({ params: Promise.resolve({ loteId }) }) as never
const eq = (q: Query, col: string, val: unknown) => q.calls.some((c) => c[0] === 'eq' && c[1] === col && c[2] === val)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-10T15:00:00Z'))
  queriesVistas = []
  rpc.mockReset()
  resolver = () => ok([])
})
afterEach(() => vi.useRealTimers())

describe('GET /api/estoque', () => {
  it('devolve hoje e itens, filtrando clínica e ativos', async () => {
    const r = await listar(req('GET'))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ hoje: '2026-11-10', itens: [] })
    expect(eq(queriesVistas[0], 'clinic_id', CLINIC)).toBe(true)
    expect(eq(queriesVistas[0], 'active', true)).toBe(true)
  })
  it('inativos=1 não filtra active', async () => {
    await listar(req('GET', undefined, '?inativos=1'))
    expect(queriesVistas[0].calls.some((c) => c[0] === 'eq' && c[1] === 'active')).toBe(false)
  })
})

describe('POST /api/estoque', () => {
  it('inválido → 422; corpo não-JSON → 422', async () => {
    const r = await criar(req('POST', {}))
    expect(r.status).toBe(422)
    expect(await r.json()).toEqual({ error: 'Informe o nome' })
    expect((await criar(reqRaw('POST', 'não é json'))).status).toBe(422)
  })
  it('ok → 201 com id', async () => {
    rpc.mockResolvedValue(ok(ID))
    const r = await criar(req('POST', { name: 'Luvas' }))
    expect(r.status).toBe(201)
    expect(await r.json()).toEqual({ id: ID })
    expect(rpc).toHaveBeenCalledWith('create_inventory_item', expect.objectContaining({ p_clinic_id: CLINIC, p_user_id: 'u1' }))
  })
  it('nome repetido (23505) → 409', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } })
    const r = await criar(req('POST', { name: 'luvas m ' }))
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ error: 'Já existe um produto com esse nome' })
  })
})

describe('PATCH /api/estoque/[id]', () => {
  it('id inválido → 404; sem active → 422; ok → 200', async () => {
    expect((await editar(req('PATCH', { name: 'A', active: true }), ctx('x'))).status).toBe(404)
    expect((await editar(req('PATCH', { name: 'A' }), ctx(ID))).status).toBe(422)
    rpc.mockResolvedValue(ok(null))
    const r = await editar(req('PATCH', { name: 'A', active: true }), ctx(ID))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
  })
  it('não encontrado → 404; nome repetido → 409', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'PRODUTO_NAO_ENCONTRADO' } })
    expect((await editar(req('PATCH', { name: 'A', active: true }), ctx(ID))).status).toBe(404)
    rpc.mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'dup' } })
    const r = await editar(req('PATCH', { name: 'Luvas M', active: true }), ctx(ID))
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ error: 'Já existe um produto com esse nome' })
  })
})

describe('POST entrada', () => {
  const corpo = { kind: 'compra', quantity: 2, totalCostCents: 5000, payment: { status: 'pending', dueDate: '2026-12-01' } }
  it('id inválido → 404; corpo inválido → 422', async () => {
    expect((await entrada(req('POST', corpo), ctx('x'))).status).toBe(404)
    expect((await entrada(req('POST', { kind: 'compra', quantity: 0 }), ctx(ID))).status).toBe(422)
    expect((await entrada(reqRaw('POST', '{'), ctx(ID))).status).toBe(422)
  })
  it('ok devolve quantity e expense', async () => {
    rpc.mockResolvedValue(ok({ quantity: 7, expense: { id: 'e1', amount: 50, status: 'pending' } }))
    const r = await entrada(req('POST', corpo), ctx(ID))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ quantity: 7, expense: { id: 'e1', amount: 50, status: 'pending' } })
  })
  it('produto inativo → 409', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'PRODUTO_INATIVO' } })
    expect((await entrada(req('POST', corpo), ctx(ID))).status).toBe(409)
  })
})

describe('POST saida', () => {
  const corpo = { kind: 'uso', quantity: 2 }
  it('id inválido → 404; corpo inválido → 422', async () => {
    expect((await saida(req('POST', corpo), ctx('x'))).status).toBe(404)
    expect((await saida(req('POST', { kind: 'uso', quantity: 1.5 }), ctx(ID))).status).toBe(422)
  })
  it('clique duplo: segunda saída sem saldo → 409 "Estoque insuficiente"', async () => {
    rpc
      .mockResolvedValueOnce(ok({ quantity: 0, lotes: [] }))
      .mockResolvedValueOnce({ data: null, error: { message: 'ESTOQUE_INSUFICIENTE' } })
    const a = await saida(req('POST', corpo), ctx(ID))
    const b = await saida(req('POST', corpo), ctx(ID))
    expect(a.status).toBe(200)
    expect(await a.json()).toEqual({ quantity: 0, lotes: [] })
    expect(b.status).toBe(409)
    expect(await b.json()).toEqual({ error: 'Estoque insuficiente' })
  })
})

describe('POST contagem', () => {
  it('ok, 404 e 422', async () => {
    expect((await contagem(req('POST', { counted: 3 }), ctx('x'))).status).toBe(404)
    expect((await contagem(req('POST', { counted: -1 }), ctx(ID))).status).toBe(422)
    rpc.mockResolvedValue(ok({ quantity: 3, diferenca: 1 }))
    const r = await contagem(req('POST', { counted: 3 }), ctx(ID))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ quantity: 3, diferenca: 1 })
  })
  it('lote obrigatório → 422', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'LOTE_OBRIGATORIO' } })
    const r = await contagem(req('POST', { counted: 3 }), ctx(ID))
    expect(r.status).toBe(422)
    expect(await r.json()).toEqual({ error: 'Informe a validade do lote' })
  })
})

describe('POST lotes/[loteId]/vencido', () => {
  it('id inválido → 404; ok; lote inexistente → 422', async () => {
    expect((await vencido(req('POST'), ctxLote('x'))).status).toBe(404)
    rpc.mockResolvedValueOnce(ok({ quantity: 1, baixado: 4 }))
    const r = await vencido(req('POST'), ctxLote(LOTE))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ quantity: 1, baixado: 4 })
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'LOTE_INVALIDO' } })
    expect((await vencido(req('POST'), ctxLote(LOTE))).status).toBe(422)
  })
})

describe('GET movimentos', () => {
  it('sem datas usa os últimos 30 dias até hoje (SP)', async () => {
    const r = await movimentos(req('GET', undefined, '/movimentos'))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ itens: [] })
    const q = queriesVistas[0]
    expect(q.calls).toContainEqual(['gte', 'created_at', '2026-10-11T00:00:00-03:00'])
    expect(q.calls).toContainEqual(['lte', 'created_at', '2026-11-10T23:59:59.999-03:00'])
    expect(eq(q, 'clinic_id', CLINIC)).toBe(true)
  })
  it('aplica produto e tipo', async () => {
    await movimentos(req('GET', undefined, `/movimentos?de=2026-11-01&ate=2026-11-05&produto=${ID}&tipo=in`))
    expect(eq(queriesVistas[0], 'item_id', ID)).toBe(true)
    expect(eq(queriesVistas[0], 'type', 'in')).toBe(true)
  })
  it('de inválida → 422; produto não-UUID → 422; tipo inválido → 422', async () => {
    const r = await movimentos(req('GET', undefined, '/movimentos?de=2026-13-45'))
    expect(r.status).toBe(422)
    expect(await r.json()).toEqual({ error: 'Data inválida' })
    expect((await movimentos(req('GET', undefined, '/movimentos?produto=x'))).status).toBe(422)
    expect((await movimentos(req('GET', undefined, '/movimentos?tipo=zz'))).status).toBe(422)
  })
})
