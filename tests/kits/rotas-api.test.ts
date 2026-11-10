import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const CLINIC = '00000000-0000-4000-8000-0000000000c1'
const USER = '00000000-0000-4000-8000-0000000000a1'
const UUID = '11111111-1111-4111-8111-111111111111'
const TR = '55555555-5555-4555-8555-555555555555'

vi.mock('@/lib/ia/rotas', async (orig) => ({
  ...(await orig<typeof import('@/lib/ia/rotas')>()),
  withClinic: async (
    _label: string,
    run: (c: unknown) => Promise<{ status: number; body: unknown }>,
  ) => {
    const r = await run({ clinicId: CLINIC, userId: USER, admin: {} })
    return Response.json(r.body, { status: r.status })
  },
}))

const repo = {
  baixar: vi.fn(),
  nomeProduto: vi.fn(),
  criar: vi.fn(),
  pendentes: vi.fn(),
}
vi.mock('@/lib/kits/repo', () => ({ createKitsRepo: () => repo }))

import { POST as postMaterial } from '@/app/api/tratamentos/[id]/material/route'
import { GET as getPendentes } from '@/app/api/tratamentos/material/pendentes/route'
import { POST as postKits } from '@/app/api/estoque/kits/route'

const post = (url: string, body: unknown) =>
  new NextRequest(url, { method: 'POST', body: JSON.stringify(body) })
const ctx = { params: Promise.resolve({ id: TR }) }

beforeEach(() => vi.resetAllMocks())

describe('POST /api/tratamentos/[id]/material', () => {
  it('estoque insuficiente cita o produto pelo nome e devolve itemId', async () => {
    repo.baixar.mockRejectedValue({ message: `ESTOQUE_INSUFICIENTE:${UUID}` })
    repo.nomeProduto.mockResolvedValue('Luva')
    const res = await postMaterial(post('http://x/api', { items: [{ itemId: UUID, quantity: 1 }] }), ctx)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Saldo insuficiente de Luva', itemId: UUID })
    expect(repo.nomeProduto).toHaveBeenCalledWith(CLINIC, UUID)
  })
  it('corpo inválido responde 422', async () => {
    const res = await postMaterial(post('http://x/api', { items: [] }), ctx)
    expect(res.status).toBe(422)
    expect(repo.baixar).not.toHaveBeenCalled()
  })
  it('id que não é uuid responde 404', async () => {
    const res = await postMaterial(post('http://x/api', {}), { params: Promise.resolve({ id: 'abc' }) })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Tratamento não encontrado')
  })
})

describe('GET /api/tratamentos/material/pendentes', () => {
  it('paciente inválido responde 422', async () => {
    const res = await getPendentes(new NextRequest('http://x/api?paciente=abc'))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'Paciente inválido' })
  })
  it('devolve os ids', async () => {
    repo.pendentes.mockResolvedValue(['a'])
    const res = await getPendentes(new NextRequest(`http://x/api?paciente=${UUID}`))
    expect(await res.json()).toEqual({ ids: ['a'] })
  })
})

describe('POST /api/estoque/kits', () => {
  it('nome repetido responde 409', async () => {
    repo.criar.mockRejectedValue({ code: '23505', message: 'dup' })
    const res = await postKits(post('http://x/api', { name: 'Resina', items: [{ itemId: UUID, quantity: 1 }] }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Já existe um kit com esse nome' })
  })
})
