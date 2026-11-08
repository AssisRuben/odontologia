import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeAdmin, type Query } from '../fakeSupabase'

const CLINIC = '00000000-0000-4000-8000-0000000000c1'
const LOTE = '11111111-1111-4111-8111-111111111111'
const ITEM = '22222222-2222-4222-8222-222222222222'
const ITEM2 = '66666666-6666-4666-8666-666666666666'
const PLAN = '33333333-3333-4333-8333-333333333333'

let resolver: (q: Query) => unknown = () => ({ data: null, error: null })
const rpc = vi.fn()

vi.mock('@/lib/auth/currentClinic', () => ({
  getCurrentClinic: async () => ({ clinicId: CLINIC, userId: 'u1' }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ ...fakeAdmin((q) => resolver(q)).admin, rpc }),
}))
vi.mock('@/lib/convenios/montagem', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/convenios/montagem')>()
  return { montarLotes: vi.fn(real.montarLotes) }
})

import { montarLotes } from '@/lib/convenios/montagem'

import { GET as listar } from '@/app/api/convenios/lotes/route'
import { PATCH as itemLote } from '@/app/api/convenios/lotes/[id]/itens/[itemId]/route'
import { POST as enviar } from '@/app/api/convenios/lotes/[id]/enviar/route'
import { GET as pendencias } from '@/app/api/convenios/pendencias/route'

const req = (body?: unknown) =>
  new Request('http://x', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }) as never
const ctxLote = (id: string) => ({ params: Promise.resolve({ id }) }) as never
const ctxItem = (id: string, itemId: string) => ({ params: Promise.resolve({ id, itemId }) }) as never

const OPERADORA = { id: PLAN, name: 'Amil', closing_day: 15, submission_days: 10, active: true }
const item = (id: string, over: Record<string, unknown> = {}) => ({
  id, guide_id: 'g1', active: true, authorization: 'autorizado', batch_id: null, executed_at: null, defer_until: null,
  guide: { insurance_plan_id: PLAN }, treatment: { status: 'completed', completed_at: '2026-10-20' }, ...over,
})
const loteAberto = {
  id: LOTE, insurance_plan_id: PLAN, period_start: '2026-10-16', period_end: '2026-11-15', due_date: '2026-11-25',
  status: 'aberto', protocol: null, sent_at: null, plan: { id: PLAN, name: 'Amil' },
}
const itensDoBanco = [item(ITEM), item(ITEM2, { authorization: 'pendente' })]

beforeEach(() => {
  vi.mocked(montarLotes).mockClear()
  rpc.mockReset().mockResolvedValue({ data: 1, error: null })
  resolver = () => ({ data: null, error: null })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/convenios/lotes', () => {
  it('cria o lote do período e atribui só itens prontos', async () => {
    let criado = false
    resolver = (q) => {
      if (q.table === 'insurance_plans') return { data: [OPERADORA], error: null }
      if (q.table === 'insurance_guide_items') {
        return { data: q.calls.some((c) => c[0] === 'in') ? [] : itensDoBanco, error: null }
      }
      if (q.table === 'insurance_batches') {
        if (q.calls.some((c) => c[0] === 'upsert')) {
          criado = true
          return { data: null, error: null }
        }
        return { data: criado ? [loteAberto] : [], error: null }
      }
      return { data: null, error: null }
    }
    const res = await listar()
    expect(res.status).toBe(200)
    expect(montarLotes).toHaveBeenCalledWith(CLINIC, expect.anything())
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('assign_batch_items', { p_clinic_id: CLINIC, p_batch_id: LOTE, p_item_ids: [ITEM] })
  })

  it('operadora desativada com fechamento ainda monta o lote', async () => {
    let criado = false
    resolver = (q) => {
      if (q.table === 'insurance_plans') return { data: [{ ...OPERADORA, active: false }], error: null }
      if (q.table === 'insurance_guide_items') {
        return { data: q.calls.some((c) => c[0] === 'in') ? [] : itensDoBanco, error: null }
      }
      if (q.table === 'insurance_batches') {
        if (q.calls.some((c) => c[0] === 'upsert')) {
          criado = true
          return { data: null, error: null }
        }
        return { data: criado ? [loteAberto] : [], error: null }
      }
      return { data: null, error: null }
    }
    expect((await listar()).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('assign_batch_items', { p_clinic_id: CLINIC, p_batch_id: LOTE, p_item_ids: [ITEM] })
  })

  it('operadora sem closing_day não monta', async () => {
    resolver = (q) =>
      q.table === 'insurance_plans'
        ? { data: [{ ...OPERADORA, closing_day: null }], error: null }
        : { data: q.table === 'insurance_batches' ? [] : itensDoBanco, error: null }
    const res = await listar()
    expect(res.status).toBe(200)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('atribuir em lote enviado não grava: responde 200 sem o item no lote', async () => {
    resolver = (q) => {
      if (q.table === 'insurance_plans') return { data: [OPERADORA], error: null }
      if (q.table === 'insurance_guide_items') {
        return { data: q.calls.some((c) => c[0] === 'in') ? [] : itensDoBanco, error: null }
      }
      return { data: [loteAberto], error: null }
    }
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'LOTE_ENVIADO' } })
    const res = await listar()
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalled()
    const body = await res.json()
    expect(body.lotes).toHaveLength(1)
    expect(body.lotes[0]).toMatchObject({ id: LOTE, total: 0, itens: [] })
  })

  it('devolve itens com total e atrasado', async () => {
    resolver = (q) => {
      if (q.table === 'insurance_plans') return { data: [{ ...OPERADORA, closing_day: null }], error: null }
      if (q.table === 'insurance_batches') return { data: [loteAberto], error: null }
      return {
        data: [{
          id: ITEM, batch_id: LOTE, code: '8100', name: 'Consulta', teeth: [{ tooth: 11, faces: ['M'] }], value: '80.10', typed: false,
          executed_at: null, guide: { patient_id: 'p1', guide_number: 'G1', password: 'S', insurance_card: 'C1', patient: { name: 'Ana' } },
          treatment: { completed_at: '2026-10-01' },
        }],
        error: null,
      }
    }
    const body = await (await listar()).json()
    expect(body.lotes[0]).toMatchObject({ plan: { id: PLAN, name: 'Amil' }, total: 80.1 })
    expect(body.lotes[0].itens[0]).toMatchObject({
      patient_name: 'Ana', insurance_card: 'C1', executed_at: '2026-10-01', atrasado: true, value: 80.1,
    })
  })
})

describe('PATCH /api/convenios/lotes/[id]/itens/[itemId]', () => {
  const lote = { id: LOTE, status: 'aberto', period_end: '2026-11-15', plan: { closing_day: 15 } }

  it('remover chama remove_batch_item com o período seguinte', async () => {
    resolver = (q) =>
      q.table === 'insurance_batches' ? { data: lote, error: null } : { data: { id: ITEM, batch_id: LOTE, treatment_id: null, guide: null }, error: null }
    const res = await itemLote(req({ remover: true }), ctxItem(LOTE, ITEM))
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('remove_batch_item', {
      p_clinic_id: CLINIC, p_batch_id: LOTE, p_item_id: ITEM, p_defer_until: '2026-11-16',
    })
  })

  it('remover item de outro lote → 404 sem chamar a RPC', async () => {
    resolver = (q) =>
      q.table === 'insurance_batches' ? { data: lote, error: null } : { data: { id: ITEM, batch_id: PLAN, treatment_id: null, guide: null }, error: null }
    const res = await itemLote(req({ remover: true }), ctxItem(LOTE, ITEM))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Item não encontrado' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('digitado em lote aberto → 200; item fora do lote → 404', async () => {
    resolver = (q) => (q.table === 'insurance_batches' ? { data: { status: 'aberto' }, error: null } : { data: [{ id: ITEM }], error: null })
    expect((await itemLote(req({ typed: true }), ctxItem(LOTE, ITEM))).status).toBe(200)
    resolver = (q) => (q.table === 'insurance_batches' ? { data: { status: 'aberto' }, error: null } : { data: [], error: null })
    const res = await itemLote(req({ typed: true }), ctxItem(LOTE, ITEM))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Item não encontrado' })
  })

  it('digitado em lote enviado → 409', async () => {
    resolver = () => ({ data: { status: 'enviado' }, error: null })
    const res = await itemLote(req({ typed: true }), ctxItem(LOTE, ITEM))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Lote já enviado' })
  })

  it('identificador inválido → 422', async () => {
    expect((await itemLote(req({ typed: true }), ctxItem('x', ITEM))).status).toBe(422)
  })
})

describe('POST /api/convenios/lotes/[id]/enviar', () => {
  it('envia o lote', async () => {
    const res = await enviar(req({ protocol: 'P1', sentAt: '2026-11-07' }), ctxLote(LOTE))
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('send_insurance_batch', {
      p_clinic_id: CLINIC, p_batch_id: LOTE, p_protocol: 'P1', p_sent_at: '2026-11-07',
    })
  })

  it('enviar duas vezes devolve 409 na segunda', async () => {
    expect((await enviar(req({ protocol: 'P1', sentAt: '2026-11-07' }), ctxLote(LOTE))).status).toBe(200)
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'LOTE_ENVIADO' } })
    const res = await enviar(req({ protocol: 'P1', sentAt: '2026-11-07' }), ctxLote(LOTE))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Lote já enviado' })
  })

  it('sem protocolo → 422', async () => {
    const res = await enviar(req({ protocol: '', sentAt: '2026-11-07' }), ctxLote(LOTE))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'Informe o protocolo' })
  })
})

describe('GET /api/convenios/pendencias', () => {
  it('monta os lotes antes de calcular as pendências', async () => {
    let criado = false
    resolver = (q) => {
      if (q.table === 'insurance_plans') {
        return q.calls.some((c) => c[0] === 'is') ? { data: [], error: null } : { data: [{ ...OPERADORA, active: false }], error: null }
      }
      if (q.table === 'insurance_guide_items') {
        return { data: q.calls.some((c) => c[0] === 'in') ? [] : itensDoBanco, error: null }
      }
      if (q.table === 'insurance_batches') {
        if (q.calls.some((c) => c[0] === 'upsert')) {
          criado = true
          return { data: null, error: null }
        }
        return { data: criado ? [{ ...loteAberto, due_date: '2026-11-08' }] : [], error: null }
      }
      return { data: [], error: null }
    }
    const res = await pendencias()
    expect(res.status).toBe(200)
    expect(montarLotes).toHaveBeenCalledWith(CLINIC, expect.anything())
    expect(rpc).toHaveBeenCalledWith('assign_batch_items', { p_clinic_id: CLINIC, p_batch_id: LOTE, p_item_ids: [ITEM] })
  })

  it('classifica tratamentos e devolve o contador', async () => {
    const T = (id: string, extra: Record<string, unknown> = {}) => ({
      id, patient_id: 'p1', procedure: 'Limpeza', insurance_plan_id: PLAN, insurance_procedure_id: 'pr',
      patient: { name: 'Ana' }, proc: { insurance_plan_id: PLAN, active: true }, ...extra,
    })
    resolver = (q) => {
      if (q.table === 'treatments') {
        return q.calls.some((c) => c[0] === 'limit')
          ? { data: [], error: null }
          : { data: [T('t1'), T('t2', { insurance_procedure_id: null, proc: null }), T('t3'), T('t4'), T('t5', { procedure: 'Canal', proc: { insurance_plan_id: PLAN, active: false } })], error: null }
      }
      if (q.table === 'insurance_guide_items') {
        return { data: [{ treatment_id: 't3', authorization: 'pendente' }, { treatment_id: 't4', authorization: 'autorizado' }], error: null }
      }
      return { data: [], error: null }
    }
    const body = await (await pendencias()).json()
    expect(body.contador).toBe(4)
    expect(body.itens.map((i: { texto: string }) => i.texto)).toEqual([
      'Limpeza de Ana: concluído sem guia',
      'Limpeza de Ana: fora da tabela do convênio',
      'Limpeza de Ana: concluído aguardando autorização',
      'Canal de Ana: fora da tabela do convênio',
    ])
  })
})
