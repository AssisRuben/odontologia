import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeAdmin, type Query } from '../fakeSupabase'

const CLINIC = '00000000-0000-4000-8000-0000000000c1'
const LOTE = '11111111-1111-4111-8111-111111111111'
const ITEM = '22222222-2222-4222-8222-222222222222'
const ITEM2 = '66666666-6666-4666-8666-666666666666'
const PLAN = '33333333-3333-4333-8333-333333333333'

let resolver: (q: Query) => unknown = () => ({ data: null, error: null })
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

import { GET as pagamentos } from '@/app/api/convenios/pagamentos/route'
import { POST as registrar, DELETE as desfazer } from '@/app/api/convenios/lotes/[id]/pagamento/route'
import { POST as recorrer } from '@/app/api/convenios/itens/[id]/recurso/route'
import { POST as resultado } from '@/app/api/convenios/itens/[id]/recurso/resultado/route'
import { POST as recebimento } from '@/app/api/convenios/itens/[id]/recurso/recebimento/route'
import { GET as motivos } from '@/app/api/convenios/motivos/route'
import { fromDbPaidAt, toDbPaidAt } from '@/lib/payments/dates'

const req = (body?: unknown, url = 'http://x') =>
  new Request(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }) as never
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never

const ok = (data: unknown) => ({ data, error: null })
const itensLote = [
  { id: ITEM, value: 100 },
  { id: ITEM2, value: 50 },
]
function loteComItens(status = 'enviado') {
  resolver = (q) => {
    if (q.table === 'insurance_batches') return ok({ status })
    if (q.table === 'insurance_guide_items') return ok(itensLote)
    return ok(null)
  }
}
const corpoPagamento = {
  paidAt: '2026-11-07',
  deposit: 120,
  itens: [
    { id: ITEM, paidValue: 100 },
    { id: ITEM2, paidValue: 20, glosaCode: '1705', glosaNote: 'sem carteira' },
  ],
}
const itemRec = (over: Record<string, unknown> = {}) => ({
  id: ITEM, glosa_value: 30, appeal_status: 'nenhum', recovered_value: null, recovered_payment_id: null,
  batch: { status: 'pago' }, ...over,
})

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: 1, error: null })
  resolver = () => ok(null)
  queriesVistas = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/convenios/lotes/[id]/pagamento', () => {
  it('id inválido → 422', async () => {
    const res = await registrar(req(corpoPagamento), ctx('x'))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'Identificador inválido' })
  })

  it('lote de outra clínica → 404', async () => {
    resolver = () => ok(null)
    const res = await registrar(req(corpoPagamento), ctx(LOTE))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Lote não encontrado' })
    expect(queriesVistas[0].calls).toContainEqual(['eq', 'clinic_id', CLINIC])
  })

  it('registra chamando a RPC com os itens do lote', async () => {
    loteComItens()
    const res = await registrar(req(corpoPagamento), ctx(LOTE))
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('register_batch_payment', {
      p_clinic_id: CLINIC, p_batch_id: LOTE, p_paid_at: '2026-11-07', p_deposit: 120,
      p_items: [
        { id: ITEM, paid_value: 100, glosa_code: null, glosa_note: null },
        { id: ITEM2, paid_value: 20, glosa_code: '1705', glosa_note: 'sem carteira' },
      ],
    })
  })

  it('o dia do depósito vira meio-dia UTC no banco e volta igual', () => {
    expect(toDbPaidAt('2026-11-07')).toBe('2026-11-07T12:00:00Z')
    expect(fromDbPaidAt(toDbPaidAt('2026-11-07'))).toBe('2026-11-07')
  })

  it('data do depósito no futuro → 422 sem chamar a RPC', async () => {
    loteComItens()
    const res = await registrar(req({ ...corpoPagamento, paidAt: '2099-01-01' }), ctx(LOTE))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'Data inválida' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('itens incompletos → 422 sem chamar a RPC', async () => {
    loteComItens()
    const res = await registrar(req({ ...corpoPagamento, itens: [corpoPagamento.itens[0]] }), ctx(LOTE))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'Informe todos os itens do lote' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('segundo registro devolve 409', async () => {
    loteComItens('pago')
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'LOTE_NAO_ENVIADO' } })
    const res = await registrar(req(corpoPagamento), ctx(LOTE))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Lote não está aguardando pagamento' })
  })

  it('motivo inexistente (FK) → 422; VALOR_INVALIDO → "Valor pago inválido"', async () => {
    loteComItens()
    rpc.mockResolvedValue({ data: null, error: { code: '23503', message: 'fk' } })
    let res = await registrar(req(corpoPagamento), ctx(LOTE))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'Motivo de glosa inválido' })
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'VALOR_INVALIDO' } })
    res = await registrar(req(corpoPagamento), ctx(LOTE))
    expect(await res.json()).toEqual({ error: 'Valor pago inválido' })
  })
})

describe('DELETE /api/convenios/lotes/[id]/pagamento', () => {
  it('desfaz pela RPC', async () => {
    const res = await desfazer(req(), ctx(LOTE))
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('undo_batch_payment', { p_clinic_id: CLINIC, p_batch_id: LOTE })
  })

  it('com recurso recebido → 409', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'RECURSO_RECEBIDO' } })
    const res = await desfazer(req(), ctx(LOTE))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Há recurso com valor já recebido neste lote' })
  })

  it('FK em outra rota não ganha o texto de motivo', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23503', message: 'fk' } })
    await expect(desfazer(req(), ctx(LOTE))).resolves.toMatchObject({ status: 500 })
  })
})

describe('POST /api/convenios/itens/[id]/recurso', () => {
  const corpo = { appealAt: '2026-11-08', appealText: 'Procedimento autorizado' }

  it('item sem glosa → 409', async () => {
    resolver = () => ok(itemRec({ glosa_value: 0 }))
    const res = await recorrer(req(corpo), ctx(ITEM))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Item não está glosado' })
  })

  it('item de outra clínica → 404', async () => {
    const res = await recorrer(req(corpo), ctx(ITEM))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Item não encontrado' })
  })

  it('sem justificativa → 422', async () => {
    const res = await recorrer(req({ ...corpo, appealText: ' ' }), ctx(ITEM))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'Informe a justificativa' })
  })

  it('lote que não está pago → 409', async () => {
    resolver = () => ok(itemRec({ batch: { status: 'enviado' } }))
    const res = await recorrer(req(corpo), ctx(ITEM))
    expect(await res.json()).toEqual({ error: 'Lote não está pago' })
  })

  it('grava em_recurso condicionado ao estado atual', async () => {
    resolver = (q) => (q.calls.some((c) => c[0] === 'update') ? ok([{ id: ITEM }]) : ok(itemRec()))
    const res = await recorrer(req(corpo), ctx(ITEM))
    expect(res.status).toBe(200)
    const upd = queriesVistas.find((q) => q.calls.some((c) => c[0] === 'update'))!
    expect(upd.calls).toContainEqual(['eq', 'appeal_status', 'nenhum'])
    expect(upd.calls).toContainEqual(['eq', 'clinic_id', CLINIC])
  })

  it('já em recurso (0 linhas) → 409', async () => {
    resolver = (q) => (q.calls.some((c) => c[0] === 'update') ? ok([]) : ok(itemRec({ appeal_status: 'em_recurso' })))
    const res = await recorrer(req(corpo), ctx(ITEM))
    expect(res.status).toBe(409)
  })
})

describe('POST /api/convenios/itens/[id]/recurso/resultado', () => {
  const comUpdate = (linhas: unknown[]) => (q: Query) =>
    q.calls.some((c) => c[0] === 'update') ? ok(linhas) : ok(itemRec({ appeal_status: 'em_recurso' }))

  it('aceito com receivedAt grava e chama a RPC', async () => {
    resolver = comUpdate([{ id: ITEM }])
    const res = await resultado(
      req({ resultado: 'aceito', recoveredValue: 25, resultAt: '2026-11-08', receivedAt: '2026-11-08' }),
      ctx(ITEM),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'aceito', recebido: true })
    expect(rpc).toHaveBeenCalledWith('receive_appeal', {
      p_clinic_id: CLINIC, p_item_id: ITEM, p_value: 25, p_received_at: '2026-11-08',
    })
  })

  it('aceito sem receivedAt não chama a RPC; negado também não', async () => {
    resolver = comUpdate([{ id: ITEM }])
    await resultado(req({ resultado: 'aceito', recoveredValue: 25, resultAt: '2026-11-08' }), ctx(ITEM))
    await resultado(req({ resultado: 'negado', resultAt: '2026-11-08' }), ctx(ITEM))
    expect(rpc).not.toHaveBeenCalled()
  })

  it('valor acima da glosa → 422 "Valor recuperado inválido"', async () => {
    resolver = comUpdate([{ id: ITEM }])
    const res = await resultado(req({ resultado: 'aceito', recoveredValue: 31, resultAt: '2026-11-08' }), ctx(ITEM))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'Valor recuperado inválido' })
  })

  it('item que não está em recurso (0 linhas) → 409', async () => {
    resolver = comUpdate([])
    const res = await resultado(req({ resultado: 'negado', resultAt: '2026-11-08' }), ctx(ITEM))
    expect(res.status).toBe(409)
  })

  it('falha mapeada no recebimento: 200 com aviso, resultado já gravado', async () => {
    resolver = comUpdate([{ id: ITEM }])
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'VALOR_INVALIDO' } })
    const res = await resultado(
      req({ resultado: 'aceito', recoveredValue: 25, resultAt: '2026-11-08', receivedAt: '2026-11-08' }),
      ctx(ITEM),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      status: 'aceito',
      recebido: false,
      aviso: 'Resultado gravado, mas o recebimento não foi registrado: Valor recuperado inválido',
    })
  })

  it('falha não mapeada no recebimento: 200 com aviso genérico e log sem dados', async () => {
    resolver = comUpdate([{ id: ITEM }])
    rpc.mockResolvedValue({ data: null, error: { code: '57014', message: 'timeout' } })
    const res = await resultado(
      req({ resultado: 'aceito', recoveredValue: 25, resultAt: '2026-11-08', receivedAt: '2026-11-08' }),
      ctx(ITEM),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      status: 'aceito',
      recebido: false,
      aviso: 'Resultado gravado, mas o recebimento não foi registrado: Erro interno. Tente novamente.',
    })
    expect(console.error).toHaveBeenCalled()
  })
})

describe('POST /api/convenios/itens/[id]/recurso/recebimento', () => {
  const aceito = itemRec({ appeal_status: 'aceito', recovered_value: 25 })

  it('usa recovered_value por padrão e manda a data do recebimento (dia yyyy-mm-dd) à RPC', async () => {
    resolver = () => ok(aceito)
    const res = await recebimento(req({ receivedAt: '2026-11-07' }), ctx(ITEM))
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('receive_appeal', {
      p_clinic_id: CLINIC, p_item_id: ITEM, p_value: 25, p_received_at: '2026-11-07',
    })
  })

  it('data do recebimento no futuro → 422 sem chamar a RPC', async () => {
    resolver = () => ok(aceito)
    const res = await recebimento(req({ receivedAt: '2099-01-01' }), ctx(ITEM))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'Data inválida' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('valor informado acima do recuperado → 422', async () => {
    resolver = () => ok(aceito)
    const res = await recebimento(req({ receivedAt: '2026-11-07', value: 26 }), ctx(ITEM))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'Valor recuperado inválido' })
  })

  it('recebimento duplicado → 409', async () => {
    resolver = () => ok({ ...aceito, recovered_payment_id: 'p1' })
    let res = await recebimento(req({ receivedAt: '2026-11-07' }), ctx(ITEM))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Recurso não está aceito ou já foi recebido' })
    expect(rpc).not.toHaveBeenCalled()
    resolver = () => ok(aceito)
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'RECURSO_INVALIDO' } })
    res = await recebimento(req({ receivedAt: '2026-11-07' }), ctx(ITEM))
    expect(res.status).toBe(409)
  })
})

describe('GET /api/convenios/motivos', () => {
  const get = (q: string) => motivos({ nextUrl: new URL(`http://x/api/convenios/motivos?q=${q}`) } as never)

  it('só dígitos busca por prefixo do código', async () => {
    resolver = () => ok([{ code: '1705', name: 'x' }])
    const res = await get('17')
    expect((await res.json()).motivos).toHaveLength(1)
    const q = queriesVistas[0]
    expect(q.table).toBe('glosa_reasons')
    expect(q.calls).toContainEqual(['like', 'code', '17%'])
    expect(q.calls).toContainEqual(['limit', 20])
  })

  it('texto busca por trecho do nome', async () => {
    resolver = () => ok([])
    await get('carteira')
    expect(queriesVistas[0].calls).toContainEqual(['ilike', 'name', '%carteira%'])
  })

  it('menos de 2 caracteres não consulta', async () => {
    const res = await get('1')
    expect((await res.json()).motivos).toEqual([])
    expect(queriesVistas).toHaveLength(0)
  })
})

describe('GET /api/convenios/pagamentos', () => {
  it('separa aguardando, glosas e pagos, filtrando a clínica', async () => {
    const plan = { id: PLAN, name: 'Amil', payment_days: 30, appeal_days: 30 }
    const L_ENV = '77777777-7777-4777-8777-777777777777'
    const lotes = [
      { id: L_ENV, insurance_plan_id: PLAN, period_end: '2020-01-15', status: 'enviado', protocol: 'P1', sent_at: '2020-01-20', paid_at: null, deposit_amount: null, plan },
      { id: LOTE, insurance_plan_id: PLAN, period_end: '2026-10-15', status: 'pago', protocol: 'P2', sent_at: '2026-10-20', paid_at: '2026-11-07', deposit_amount: 120, plan },
    ]
    const it = (id: string, batch: string, over: Record<string, unknown>) => ({
      id, batch_id: batch, code: '81000065', name: 'Restauração', value: 100, paid_value: null, glosa_value: null,
      glosa_code: null, glosa_note: null, appeal_status: 'nenhum', appeal_at: null, appeal_result_at: null,
      recovered_value: null, recovered_payment_id: null, guide: { patient: { name: 'Ana' } }, reason: null, ...over,
    })
    const itens = [
      it('a1', L_ENV, { value: 80 }),
      it(ITEM, LOTE, { value: 100, paid_value: 100, glosa_value: 0 }),
      it(ITEM2, LOTE, { value: 50, paid_value: 20, glosa_value: 30, glosa_code: '1705', reason: { name: 'Sem carteira' } }),
      it('a3', LOTE, { value: 40, paid_value: 0, glosa_value: 40, appeal_status: 'aceito', recovered_value: 40, recovered_payment_id: 'p9' }),
    ]
    resolver = (q) => (q.table === 'insurance_batches' ? ok(lotes) : ok(itens))
    const res = await pagamentos()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.aguardando).toEqual([
      expect.objectContaining({ id: L_ENV, plan_name: 'Amil', total: 80, data_prevista: '2020-02-19', atrasado: true }),
    ])
    expect(body.glosas).toHaveLength(1)
    expect(body.glosas[0]).toMatchObject({
      item_id: ITEM2, patient_name: 'Ana', glosa_code: '1705', glosa_reason: 'Sem carteira', glosa_value: 30, prazo_recurso: '2026-12-07',
    })
    expect(body.pagos).toHaveLength(1)
    expect(body.pagos[0].totais).toEqual({ enviado: 190, pago: 120, glosado: 70, diferenca: 0 })
    expect(body.pagos[0].tem_recurso).toBe(true)
    for (const q of queriesVistas) expect(q.calls).toContainEqual(['eq', 'clinic_id', CLINIC])
  })

  it('tem_recurso é false quando nenhum item do lote tem recurso', async () => {
    const plan = { id: PLAN, name: 'Amil', payment_days: 30, appeal_days: 30 }
    const lote = { id: LOTE, insurance_plan_id: PLAN, period_end: '2026-10-15', status: 'pago', protocol: null, sent_at: '2026-10-20', paid_at: '2026-11-07', deposit_amount: 70, plan }
    const glosado = {
      id: ITEM, batch_id: LOTE, code: '1', name: 'x', value: 100, paid_value: 70, glosa_value: 30, glosa_code: '1705', glosa_note: null,
      appeal_status: 'nenhum', appeal_at: null, appeal_result_at: null, recovered_value: null, recovered_payment_id: null, guide: null, reason: null,
    }
    resolver = (q) => {
      if (q.table === 'insurance_batches') return ok([lote])
      if (q.calls.some((c) => c[0] === 'in' && c[1] === 'batch_id')) return ok([glosado])
      return ok([])
    }
    const body = await (await pagamentos()).json()
    expect(body.pagos[0].tem_recurso).toBe(false)
    expect(body.glosas.map((g: { item_id: string }) => g.item_id)).toEqual([ITEM])
  })

  it('recurso aberto de lote pago há mais de 6 meses continua nas glosas; glosa sem recurso desse lote não', async () => {
    const L_VELHO = '88888888-8888-4888-8888-888888888888'
    const velho = { status: 'pago', paid_at: '2026-04-01', plan: { appeal_days: 30 } }
    const item = (id: string, over: Record<string, unknown>) => ({
      id, batch_id: L_VELHO, code: '81000065', name: 'Restauração', value: 100, paid_value: 60, glosa_value: 40,
      glosa_code: '1705', glosa_note: null, appeal_status: 'nenhum', appeal_at: null, appeal_result_at: null,
      recovered_value: null, recovered_payment_id: null, guide: { patient: { name: 'Bia' } }, reason: null, batch: velho, ...over,
    })
    resolver = (q) => {
      if (q.table === 'insurance_batches') return ok([])
      if (q.calls.some((c) => c[0] === 'in' && c[1] === 'appeal_status')) {
        return ok([
          item('v1', { appeal_status: 'aceito', appeal_at: '2026-04-20', appeal_result_at: '2026-06-01', recovered_value: 40 }),
          item('v2', {}),
          item('v3', { appeal_status: 'aceito', recovered_value: 40, recovered_payment_id: 'p1' }),
        ])
      }
      return ok([])
    }
    const body = await (await pagamentos()).json()
    expect(body.glosas).toEqual([
      expect.objectContaining({
        item_id: 'v1', batch_id: L_VELHO, patient_name: 'Bia', appeal_status: 'aceito', recovered_value: 40, paid_at: '2026-04-01',
      }),
    ])
    const rec = queriesVistas.find((q) => q.calls.some((c) => c[0] === 'in' && c[1] === 'appeal_status'))!
    expect(rec.table).toBe('insurance_guide_items')
    expect(rec.calls).toContainEqual(['eq', 'clinic_id', CLINIC])
    expect(rec.calls).toContainEqual(['in', 'appeal_status', ['em_recurso', 'aceito']])
    expect(rec.calls).toContainEqual(['is', 'recovered_payment_id', null])
    expect(rec.calls.some((c) => c[0] === 'gte')).toBe(false)
  })
})
