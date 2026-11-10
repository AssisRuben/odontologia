import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const CLINIC = '00000000-0000-4000-8000-0000000000c1'
const USER = '00000000-0000-4000-8000-0000000000a1'
const UUID = '11111111-1111-4111-8111-111111111111'

vi.mock('@/lib/ia/rotas', async (orig) => ({
  ...(await orig<typeof import('@/lib/ia/rotas')>()),
  withClinic: async (_l: string, run: (c: unknown) => Promise<{ status: number; body: unknown }>) => {
    const r = await run({ clinicId: CLINIC, userId: USER, admin: {} })
    return Response.json(r.body, { status: r.status })
  },
}))

const repo = {
  gerar: vi.fn(), saldoAtual: vi.fn(), dados: vi.fn(), informarSaldo: vi.fn(),
  criarRecorrencia: vi.fn(), editarRecorrencia: vi.fn(), encerrarRecorrencia: vi.fn(),
}
vi.mock('@/lib/fluxo/repo', () => ({ createFluxoRepo: () => repo }))

import { GET as getFluxo } from '@/app/api/financeiro/fluxo/route'
import { POST as postSaldo } from '@/app/api/financeiro/saldo/route'
import { PATCH as patchRec } from '@/app/api/financeiro/recorrencias/[id]/route'
import { POST as postEncerrar } from '@/app/api/financeiro/recorrencias/[id]/encerrar/route'
import { POST as postGerar } from '@/app/api/financeiro/recorrencias/gerar/route'

const req = (method: string, body?: unknown) =>
  new NextRequest('http://x/api', { method, body: body === undefined ? undefined : JSON.stringify(body) })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => vi.resetAllMocks())

describe('GET fluxo', () => {
  it('responde 200 com 8 meses', async () => {
    repo.gerar.mockResolvedValue(0)
    repo.saldoAtual.mockResolvedValue(null)
    repo.dados.mockResolvedValue({ pagamentos: [], despesas: [] })
    const res = await getFluxo()
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.meses).toHaveLength(8)
    expect(j.saldoInformado).toBeNull()
    expect(repo.gerar).toHaveBeenCalledWith(CLINIC)
  })
})

describe('POST saldo', () => {
  it('data futura responde 422', async () => {
    const res = await postSaldo(req('POST', { data: '2999-01-01', valorCentavos: 100 }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('A data não pode ser futura')
  })
  it('válido responde 201', async () => {
    repo.informarSaldo.mockResolvedValue(undefined)
    const res = await postSaldo(req('POST', { data: '2020-01-01', valorCentavos: -100 }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ ok: true })
  })
})

describe('recorrências', () => {
  it('PATCH com id inválido responde 404', async () => {
    const res = await patchRec(req('PATCH', {}), ctx('abc'))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Recorrência não encontrada')
  })
  it('encerrar: PERIODO_INVALIDO vira 422', async () => {
    repo.encerrarRecorrencia.mockRejectedValue({ message: 'PERIODO_INVALIDO' })
    const res = await postEncerrar(req('POST', { ultimoMes: '2026-12' }), ctx(UUID))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('Período inválido')
  })
  it('gerar responde criadas', async () => {
    repo.gerar.mockResolvedValue(3)
    const res = await postGerar()
    expect(await res.json()).toEqual({ criadas: 3 })
  })
})
