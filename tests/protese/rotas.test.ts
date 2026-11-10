import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeAdmin, type Query } from '../fakeSupabase'

const CLINIC = '00000000-0000-4000-8000-0000000000c1'
const PAC = '22222222-2222-4222-8222-222222222222'
const ID = '33333333-3333-4333-8333-333333333333'

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

import { GET as listar, POST as criar } from '@/app/api/protese/route'
import { PATCH as editar, DELETE as excluir } from '@/app/api/protese/[id]/route'
import { POST as mover } from '@/app/api/protese/[id]/mover/route'
import { GET as labs, POST as criarLab } from '@/app/api/laboratorios/route'
import { PATCH as editarLab } from '@/app/api/laboratorios/[id]/route'

const ok = (data: unknown) => ({ data, error: null })
const req = (method: string, body?: unknown, qs = '') =>
  new Request(`http://x/api/protese${qs}`, { method, body: body === undefined ? undefined : JSON.stringify(body) }) as never
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-10T15:00:00Z'))
  queriesVistas = []
  rpc.mockReset()
  resolver = () => ok([])
})
afterEach(() => vi.useRealTimers())

describe('GET /api/protese', () => {
  it('devolve hoje e itens, filtrando pela clínica', async () => {
    const r = await listar(req('GET'))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ hoje: '2026-11-10', itens: [] })
    expect(queriesVistas[0].table).toBe('prosthetics')
    expect(queriesVistas[0].calls.some((c) => c[0] === 'eq' && c[1] === 'clinic_id' && c[2] === CLINIC)).toBe(true)
  })
  it('paciente filtra e não-UUID → 422', async () => {
    await listar(req('GET', undefined, `?paciente=${PAC}`))
    expect(queriesVistas[0].calls.some((c) => c[0] === 'eq' && c[1] === 'patient_id' && c[2] === PAC)).toBe(true)
    expect((await listar(req('GET', undefined, '?paciente=x'))).status).toBe(422)
  })
})

describe('POST /api/protese', () => {
  it('inválido → 422 com a mensagem do parser', async () => {
    const r = await criar(req('POST', {}))
    expect(r.status).toBe(422)
    expect(await r.json()).toEqual({ error: 'Escolha o paciente' })
  })
  it('ok → 201 com id', async () => {
    rpc.mockResolvedValue({ data: ID, error: null })
    const r = await criar(req('POST', { patientId: PAC }))
    expect(r.status).toBe(201)
    expect(await r.json()).toEqual({ id: ID })
    expect(rpc).toHaveBeenCalledWith('create_prosthetic', expect.objectContaining({ p_clinic_id: CLINIC, p_user_id: 'u1' }))
  })
})

describe('PATCH/DELETE /api/protese/[id]', () => {
  it('id inválido → 404', async () => {
    expect((await editar(req('PATCH', { patientId: PAC }), ctx('x'))).status).toBe(404)
    expect((await excluir(req('DELETE'), ctx('x'))).status).toBe(404)
  })
  it('PATCH corpo inválido → 422; ok → 200', async () => {
    expect((await editar(req('PATCH', {}), ctx(ID))).status).toBe(422)
    rpc.mockResolvedValue({ data: { expense: null, aviso: null, despesa_removida: false }, error: null })
    const r = await editar(req('PATCH', { patientId: PAC }), ctx(ID))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ expense: null, aviso: null, despesaRemovida: false })
  })
  it('PATCH não encontrado → 404', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'PROTESE_NAO_ENCONTRADA' } })
    expect((await editar(req('PATCH', { patientId: PAC }), ctx(ID))).status).toBe(404)
  })
  it('DELETE ok', async () => {
    rpc.mockResolvedValue({ data: { despesa: 'apagada' }, error: null })
    const r = await excluir(req('DELETE'), ctx(ID))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ despesa: 'apagada' })
  })
})

describe('POST /api/protese/[id]/mover', () => {
  const corpo = { de: 'requested', para: 'sent_to_lab' }
  it('id inválido → 404; corpo inválido → 422', async () => {
    expect((await mover(req('POST', corpo), ctx('x'))).status).toBe(404)
    const r = await mover(req('POST', { de: 'requested', para: 'requested' }), ctx(ID))
    expect(r.status).toBe(422)
    expect(await r.json()).toEqual({ error: 'Escolha outra etapa' })
  })
  it('ok devolve status e expense', async () => {
    rpc.mockResolvedValue({ data: { status: 'sent_to_lab', expense: { id: 'e1', amount: 80 } }, error: null })
    const r = await mover(req('POST', corpo), ctx(ID))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ status: 'sent_to_lab', expense: { id: 'e1', amount: 80 } })
    expect(rpc).toHaveBeenCalledWith(
      'move_prosthetic',
      expect.objectContaining({ p_clinic_id: CLINIC, p_id: ID, p_from: 'requested', p_to: 'sent_to_lab' }),
    )
  })
  it('clique duplo: segundo pedido com "de" desatualizado → 409', async () => {
    rpc
      .mockResolvedValueOnce({ data: { status: 'sent_to_lab', expense: null }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'PROTESE_CONFLITO' } })
    const a = await mover(req('POST', corpo), ctx(ID))
    const b = await mover(req('POST', corpo), ctx(ID))
    expect(a.status).toBe(200)
    expect(b.status).toBe(409)
    expect(await b.json()).toEqual({ error: 'Este trabalho foi atualizado por outra pessoa' })
  })
})

describe('laboratórios', () => {
  it('GET lista', async () => {
    const r = await labs()
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ itens: [] })
  })
  it('POST inválido → 422; ok → 201', async () => {
    expect((await criarLab(req('POST', { name: ' ' }))).status).toBe(422)
    resolver = () => ok({ id: ID, name: 'Lab X' })
    const r = await criarLab(req('POST', { name: ' Lab X ' }))
    expect(r.status).toBe(201)
    expect(await r.json()).toEqual({ laboratorio: { id: ID, name: 'Lab X' } })
  })
  it('POST nome duplicado (23505) → 409', async () => {
    resolver = () => ({ data: null, error: { code: '23505', message: 'duplicate key' } })
    const r = await criarLab(req('POST', { name: 'lab x ' }))
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ error: 'Já existe um laboratório com esse nome' })
  })
  it('PATCH: id inválido → 404; vazio → 422; sem linha → 404; ok só com os campos enviados', async () => {
    expect((await editarLab(req('PATCH', { active: false }), ctx('x'))).status).toBe(404)
    expect((await editarLab(req('PATCH', {}), ctx(ID))).status).toBe(422)
    resolver = () => ok([])
    const nf = await editarLab(req('PATCH', { active: false }), ctx(ID))
    expect(nf.status).toBe(404)
    expect(await nf.json()).toEqual({ error: 'Laboratório não encontrado' })
    queriesVistas = []
    resolver = () => ok([{ id: ID }])
    const r = await editarLab(req('PATCH', { active: false }), ctx(ID))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
    expect(queriesVistas[0].calls.find((c) => c[0] === 'update')?.[1]).toEqual({ active: false })
  })
  it('PATCH nome duplicado → 409', async () => {
    resolver = () => ({ data: null, error: { code: '23505', message: 'dup' } })
    expect((await editarLab(req('PATCH', { name: 'Lab X' }), ctx(ID))).status).toBe(409)
  })
})
