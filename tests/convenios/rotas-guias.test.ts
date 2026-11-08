import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeAdmin, type Query } from '../fakeSupabase'

const CLINIC = '00000000-0000-4000-8000-0000000000c1'
const ID = '11111111-1111-4111-8111-111111111111'
const PAT = '22222222-2222-4222-8222-222222222222'
const PLAN = '33333333-3333-4333-8333-333333333333'
const TR = '44444444-4444-4444-8444-444444444444'
const PRO = '55555555-5555-4555-8555-555555555555'

let resolver: (q: Query) => unknown = () => ({ data: null, error: null })
const rpc = vi.fn()

vi.mock('@/lib/auth/currentClinic', () => ({
  getCurrentClinic: async () => ({ clinicId: CLINIC, userId: 'u1' }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ ...fakeAdmin((q) => resolver(q)).admin, rpc }),
}))

import { POST as criar } from '@/app/api/guias/route'
import { POST as responder } from '@/app/api/guias/[id]/resposta/route'
import { POST as cancelar } from '@/app/api/guias/[id]/cancelar/route'
import { PATCH as executado } from '@/app/api/guias/itens/[id]/route'
import { POST as atualizar } from '@/app/api/guias/itens/[id]/atualizar/route'

const req = (body?: unknown) =>
  new Request('http://x', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }) as never
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never

const tratamento = (extra: Record<string, unknown> = {}) => ({
  id: TR, patient_id: PAT, insurance_plan_id: PLAN, status: 'completed', value: 80,
  treatment_teeth: [{ tooth_number: 11, faces: ['M'] }],
  insurance_plan_procedures: { code: '8100', name: 'Consulta', requires_authorization: true, active: true, insurance_plan_id: PLAN },
  ...extra,
})

function dadosCriacao(over: Partial<Record<string, unknown>> = {}) {
  const base: Record<string, unknown> = {
    patients: { data: { insurance_card: '123' }, error: null },
    insurance_plans: { data: { id: PLAN }, error: null },
    professionals: { data: { id: PRO }, error: null },
    treatments: { data: [tratamento()], error: null },
    insurance_guide_items: { data: [], error: null },
    ...over,
  }
  resolver = (q) => base[q.table]
}

const GUIDE = { insurance_plan_id: PLAN, patient_id: PAT }
const corpo = { patientId: PAT, insurancePlanId: PLAN, treatmentIds: [TR] }

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: ID, error: null })
  resolver = () => ({ data: null, error: null })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/guias', () => {
  it('cria a guia e copia a carteirinha do paciente', async () => {
    dadosCriacao()
    const res = await criar(req(corpo))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: ID, status: 'aguardando' })
    const args = rpc.mock.calls[0][1]
    expect(rpc.mock.calls[0][0]).toBe('create_insurance_guide')
    expect(args).toMatchObject({ p_clinic_id: CLINIC, p_card: '123', p_status: 'aguardando' })
  })

  it('tratamento em guia ativa → 422', async () => {
    dadosCriacao({ insurance_guide_items: { data: [{ treatment_id: TR }], error: null } })
    const res = await criar(req(corpo))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'Tratamento já está em outra guia' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('RPC com 23505 → 409', async () => {
    dadosCriacao()
    rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate' } })
    const res = await criar(req(corpo))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Tratamento já está em outra guia' })
  })

  it('paciente, convênio e profissional de outra clínica', async () => {
    dadosCriacao({ patients: { data: null, error: null } })
    let res = await criar(req(corpo))
    expect([res.status, (await res.json()).error]).toEqual([404, 'Paciente não encontrado'])
    dadosCriacao({ insurance_plans: { data: null, error: null } })
    res = await criar(req(corpo))
    expect([res.status, (await res.json()).error]).toEqual([404, 'Convênio não encontrado'])
    dadosCriacao({ professionals: { data: null, error: null } })
    res = await criar(req({ ...corpo, professionalId: PRO }))
    expect([res.status, (await res.json()).error]).toEqual([422, 'Profissional inválido'])
  })

  it('corpo inválido → 422', async () => {
    const res = await criar(req({ patientId: 'x' }))
    expect(res.status).toBe(422)
  })
})

describe('demais rotas', () => {
  it('id não UUID → 422', async () => {
    for (const r of [responder(req({}), ctx('x')), cancelar(req(), ctx('x')), executado(req({ executedAt: '2026-11-07' }), ctx('x')), atualizar(req(), ctx('x'))]) {
      const res = await r
      expect(res.status).toBe(422)
      expect(await res.json()).toEqual({ error: 'Identificador inválido' })
    }
  })

  it('resposta com GUIA_EM_LOTE → 409', async () => {
    resolver = (q) =>
      q.table === 'insurance_guides'
        ? { data: { id: ID }, error: null }
        : { data: [{ id: TR, requires_authorization: true, batch_id: null }], error: null }
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'GUIA_EM_LOTE' } })
    const res = await responder(req({ itens: [{ id: TR, authorization: 'autorizado' }] }), ctx(ID))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Guia com item em lote não pode ser alterada' })
  })

  it('resposta bem-sucedida devolve o status', async () => {
    resolver = (q) =>
      q.table === 'insurance_guides'
        ? { data: { id: ID }, error: null }
        : { data: [{ id: TR, requires_authorization: true, batch_id: null }], error: null }
    rpc.mockResolvedValue({ data: 'liberada', error: null })
    const res = await responder(req({ guideNumber: '77', itens: [{ id: TR, authorization: 'autorizado' }] }), ctx(ID))
    expect(await res.json()).toEqual({ status: 'liberada' })
  })

  it('guia inexistente → 404', async () => {
    const res = await responder(req({}), ctx(ID))
    expect(res.status).toBe(404)
  })

  it('cancelar com GUIA_CANCELADA → 409; sucesso → ok', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'GUIA_CANCELADA' } })
    expect((await cancelar(req(), ctx(ID))).status).toBe(409)
    rpc.mockResolvedValue({ data: null, error: null })
    const res = await cancelar(req(), ctx(ID))
    expect(await res.json()).toEqual({ ok: true })
  })

  it('atualizar item em lote → 409', async () => {
    resolver = () => ({ data: { id: ID, batch_id: 'b1', treatment_id: TR }, error: null })
    const res = await atualizar(req(), ctx(ID))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Item em lote não pode ser alterado' })
  })

  it('atualizar item recopia dados; fora da tabela → 422', async () => {
    const updates: Query[] = []
    resolver = (q) => {
      if (q.calls.some((c) => c[0] === 'update')) { updates.push(q); return { data: [{ id: ID }], error: null } }
      if (q.table === 'insurance_guide_items' && q.calls.some((c) => c[0] === 'maybeSingle')) {
        return { data: { id: ID, batch_id: null, treatment_id: TR, guide: GUIDE }, error: null }
      }
      if (q.table === 'treatments') return { data: [tratamento()], error: null }
      return { data: [], error: null }
    }
    const res = await atualizar(req(), ctx(ID))
    expect(res.status).toBe(200)
    expect(updates[0].calls[0]).toEqual(['update', { code: '8100', name: 'Consulta', teeth: [{ tooth: 11, faces: ['M'] }], value: 80 }])

    resolver = (q) =>
      q.table === 'treatments'
        ? { data: [tratamento({ insurance_plan_procedures: null })], error: null }
        : q.table === 'insurance_guide_items' && q.calls.some((c) => c[0] === 'maybeSingle')
          ? { data: { id: ID, batch_id: null, treatment_id: TR, guide: GUIDE }, error: null }
          : { data: [], error: null }
    const r2 = await atualizar(req(), ctx(ID))
    expect(r2.status).toBe(422)
    expect(await r2.json()).toEqual({ error: 'Tratamento fora da tabela do convênio' })
  })

  it('atualizar: tratamento de outro convênio/paciente ou procedimento de outro plano → 422', async () => {
    for (const guide of [{ insurance_plan_id: 'outro', patient_id: PAT }, { insurance_plan_id: PLAN, patient_id: 'outro' }]) {
      resolver = (q) =>
        q.table === 'treatments'
          ? { data: [tratamento()], error: null }
          : q.table === 'insurance_guide_items' && q.calls.some((c) => c[0] === 'maybeSingle')
            ? { data: { id: ID, batch_id: null, treatment_id: TR, guide }, error: null }
            : { data: [], error: null }
      const res = await atualizar(req(), ctx(ID))
      expect([res.status, (await res.json()).error]).toEqual([422, 'Tratamento fora da tabela do convênio'])
    }
    resolver = (q) =>
      q.table === 'treatments'
        ? { data: [tratamento({ insurance_plan_procedures: { code: '1', name: 'n', requires_authorization: false, active: true, insurance_plan_id: 'outro' } })], error: null }
        : q.table === 'insurance_guide_items' && q.calls.some((c) => c[0] === 'maybeSingle')
          ? { data: { id: ID, batch_id: null, treatment_id: TR, guide: GUIDE }, error: null }
          : { data: [], error: null }
    expect((await atualizar(req(), ctx(ID))).status).toBe(422)
  })

  it('PATCH executedAt: item em lote → 409, ok, inexistente → 404', async () => {
    resolver = () => ({ data: { id: ID, batch_id: 'b1', treatment_id: TR }, error: null })
    expect((await executado(req({ executedAt: '2026-11-07' }), ctx(ID))).status).toBe(409)
    resolver = (q) =>
      q.calls.some((c) => c[0] === 'update')
        ? { data: [{ id: ID }], error: null }
        : { data: { id: ID, batch_id: null, treatment_id: TR, guide: GUIDE }, error: null }
    expect((await executado(req({ executedAt: '2026-11-07' }), ctx(ID))).status).toBe(200)
    resolver = () => ({ data: null, error: null })
    expect((await executado(req({ executedAt: '2026-11-07' }), ctx(ID))).status).toBe(404)
    expect((await executado(req({ executedAt: 'x' }), ctx(ID))).status).toBe(422)
  })
})
