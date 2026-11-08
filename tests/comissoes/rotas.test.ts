import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeAdmin, type Query } from '../fakeSupabase'

const CLINIC = '00000000-0000-4000-8000-0000000000c1'
const PROF = '11111111-1111-4111-8111-111111111111'
const PAC = '22222222-2222-4222-8222-222222222222'
const FECH = '33333333-3333-4333-8333-333333333333'

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

import { GET as resumo } from '@/app/api/comissoes/route'
import { GET as extratoRota } from '@/app/api/comissoes/[profissionalId]/route'
import { POST as fechar } from '@/app/api/comissoes/fechamentos/route'
import { DELETE as reabrir } from '@/app/api/comissoes/fechamentos/[id]/route'
import { POST as pagar, DELETE as desfazer } from '@/app/api/comissoes/fechamentos/[id]/pagamento/route'

const ok = (data: unknown) => ({ data, error: null })
const get = (qs = '') => new Request(`http://x/api/comissoes${qs}`) as never
const post = (body?: unknown) =>
  new Request('http://x', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }) as never
const ctxId = (id: string) => ({ params: Promise.resolve({ id }) }) as never
const ctxProf = (profissionalId: string) => ({ params: Promise.resolve({ profissionalId }) }) as never

// Paciente pagou 1020 em 05/10 por um tratamento de 1020 concluído em 04/10; dentista com 40% → 408.
type Prof = { id: string; name: string; commission_rate: number | null; commission_rate_insurance: number | null; commission_start: string | null }
function cenario(profissionais: Prof[] = [{ id: PROF, name: 'Ana', commission_rate: 40, commission_rate_insurance: null, commission_start: '2026-01-01' }]) {
  resolver = (q) => {
    switch (q.table) {
      case 'payments':
        return ok([{ id: 'p1', patient_id: PAC, amount: 1020, net_amount: null, payment_method: 'pix', paid_at: '2026-10-05T12:00:00Z', created_at: 'c' }])
      case 'treatments':
        return ok([{ id: 't1', patient_id: PAC, professional_id: PROF, procedure: 'Implante', value: 1020, completed_at: '2026-10-04', created_at: 'c' }])
      case 'professionals':
        return ok(q.calls.some((c) => c[0] === 'maybeSingle') ? (profissionais[0] ?? null) : profissionais)
      case 'patients':
        return ok([{ id: PAC, name: 'Bia' }])
      default:
        return ok([])
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-08T15:00:00Z'))
  queriesVistas = []
  rpc.mockReset()
  rpc.mockResolvedValue({ data: 'novo-id', error: null })
  cenario()
})
afterEach(() => vi.useRealTimers())

describe('GET /api/comissoes', () => {
  it.each([[''], ['?mes=2026-13'], ['?mes=outubro']])('mês inválido %s → 422', async (qs) => {
    const r = await resumo(get(qs))
    expect(r.status).toBe(422)
    expect(await r.json()).toEqual({ error: 'Mês inválido' })
  })

  it('devolve o resumo calculado e filtra a clínica em todas as leituras', async () => {
    const r = await resumo(get('?mes=2026-10'))
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body).toMatchObject({ mes: '2026-10', hoje: '2026-11-08', encerrado: true })
    expect(body.dentistas).toHaveLength(1)
    expect(body.dentistas[0]).toMatchObject({
      professional_id: PROF, situacao: 'aberto', particularBaseCentavos: 102000, comissaoMesCentavos: 40800, totalCentavos: 40800,
    })
    expect(queriesVistas.length).toBeGreaterThan(0)
    for (const q of queriesVistas) {
      expect(q.calls.some((c) => c[0] === 'eq' && c[1] === 'clinic_id' && c[2] === CLINIC)).toBe(true)
    }
  })

  it('mês corrente não está encerrado', async () => {
    const body = await (await resumo(get('?mes=2026-11'))).json()
    expect(body.encerrado).toBe(false)
  })
})

describe('GET /api/comissoes/[profissionalId]', () => {
  it('id não UUID → 422; mês inválido → 422', async () => {
    expect((await extratoRota(get('?mes=2026-10'), ctxProf('x'))).status).toBe(422)
    const r = await extratoRota(get('?mes=2026-1'), ctxProf(PROF))
    expect(r.status).toBe(422)
    expect(await r.json()).toEqual({ error: 'Mês inválido' })
  })
  it('profissional de outra clínica → 404', async () => {
    cenario([])
    const r = await extratoRota(get('?mes=2026-10'), ctxProf(PROF))
    expect(r.status).toBe(404)
    expect(await r.json()).toEqual({ error: 'Profissional não encontrado' })
  })
  it('devolve o extrato', async () => {
    const r = await extratoRota(get('?mes=2026-10'), ctxProf(PROF))
    expect(r.status).toBe(200)
    const x = await r.json()
    expect(x).toMatchObject({ professional_id: PROF, nome: 'Ana', mes: '2026-10', totalCentavos: 40800 })
    expect(x.partes).toHaveLength(1)
    expect(x.partes[0]).toMatchObject({ paciente: 'Bia', origem: 'particular', baseCentavos: 102000, comissaoCentavos: 40800 })
  })
})

describe('POST /api/comissoes/fechamentos', () => {
  it('fecha mês encerrado chamando close_commission', async () => {
    const r = await fechar(post({ professionalId: PROF, mes: '2026-10' }))
    expect(r.status).toBe(201)
    expect(await r.json()).toEqual({ id: 'novo-id' })
    expect(rpc).toHaveBeenCalledTimes(1)
    const [nome, args] = rpc.mock.calls[0]
    expect(nome).toBe('close_commission')
    expect(args).toMatchObject({ p_clinic_id: CLINIC, p_professional_id: PROF, p_period: '2026-10-01', p_amount: 408 })
    expect(args.p_statement.totalCentavos).toBe(40800)
  })
  it('validação: id e mês', async () => {
    expect((await fechar(post({ professionalId: 'x', mes: '2026-10' }))).status).toBe(422)
    const r = await fechar(post({ professionalId: PROF, mes: '2026-13' }))
    expect(r.status).toBe(422)
    expect(await r.json()).toEqual({ error: 'Mês inválido' })
    expect((await fechar(post())).status).toBe(422)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('fechar mês corrente → 409 sem chamar a RPC', async () => {
    const r = await fechar(post({ professionalId: PROF, mes: '2026-11' }))
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ error: 'O mês ainda não terminou' })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('total zero → 409 sem chamar a RPC', async () => {
    const r = await fechar(post({ professionalId: PROF, mes: '2026-09' }))
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ error: 'Não há comissão a fechar neste mês' })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('profissional de outra clínica → 404', async () => {
    cenario([])
    expect((await fechar(post({ professionalId: PROF, mes: '2026-10' }))).status).toBe(404)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('FECHAMENTO_EXISTE → 409', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'FECHAMENTO_EXISTE' } })
    const r = await fechar(post({ professionalId: PROF, mes: '2026-10' }))
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ error: 'Este mês já foi fechado' })
  })
  it.each([['2026-11-01'], [null]])('mês anterior ao início (%s) → 409 sem chamar a RPC', async (inicio) => {
    cenario([{ id: PROF, name: 'Ana', commission_rate: 40, commission_rate_insurance: null, commission_start: inicio }])
    const r = await fechar(post({ professionalId: PROF, mes: '2026-10' }))
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ error: 'Mês anterior ao início da comissão' })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('ANTES_DO_INICIO da RPC → 409', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'ANTES_DO_INICIO' } })
    const r = await fechar(post({ professionalId: PROF, mes: '2026-10' }))
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ error: 'Mês anterior ao início da comissão' })
  })
  it('violação de unicidade (23505) → 409 mês já fechado', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } })
    const r = await fechar(post({ professionalId: PROF, mes: '2026-10' }))
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ error: 'Este mês já foi fechado' })
  })
  it('erro desconhecido → 500', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } })
    const r = await fechar(post({ professionalId: PROF, mes: '2026-10' }))
    expect(r.status).toBe(500)
    log.mockRestore()
  })
})

describe('DELETE /api/comissoes/fechamentos/[id]', () => {
  it('id não UUID → 422', async () => {
    expect((await reabrir(post(), ctxId('x'))).status).toBe(422)
  })
  it('reabre', async () => {
    const r = await reabrir(post(), ctxId(FECH))
    expect(r.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('reopen_commission', { p_clinic_id: CLINIC, p_closing_id: FECH })
  })
  it('FECHAMENTO_PAGO → 409', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'FECHAMENTO_PAGO' } })
    const r = await reabrir(post(), ctxId(FECH))
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ error: 'Desfaça o pagamento antes de reabrir' })
  })
  it('FECHAMENTO_INVALIDO → 404', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'FECHAMENTO_INVALIDO' } })
    expect((await reabrir(post(), ctxId(FECH))).status).toBe(404)
  })
})

describe('pagamento da comissão', () => {
  it('id não UUID → 422', async () => {
    expect((await pagar(post({ paidAt: '2026-11-05', paymentMethod: 'pix' }), ctxId('x'))).status).toBe(422)
    expect((await desfazer(post(), ctxId('x'))).status).toBe(422)
  })
  it.each([
    [{ paidAt: '2026-11-05', paymentMethod: 'fiado' }, 'Forma de pagamento inválida'],
    [{ paidAt: '2026-13-05', paymentMethod: 'pix' }, 'Data inválida'],
    [{ paymentMethod: 'pix' }, 'Data inválida'],
  ])('corpo inválido %j → 422 sem RPC', async (corpo, erro) => {
    const r = await pagar(post(corpo), ctxId(FECH))
    expect(r.status).toBe(422)
    expect(await r.json()).toEqual({ error: erro })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('paga chamando pay_commission', async () => {
    rpc.mockResolvedValue({ data: 'desp-1', error: null })
    const r = await pagar(post({ paidAt: '2026-11-05', paymentMethod: 'pix' }), ctxId(FECH))
    expect(r.status).toBe(201)
    expect(await r.json()).toEqual({ expenseId: 'desp-1' })
    expect(rpc).toHaveBeenCalledWith('pay_commission', {
      p_clinic_id: CLINIC, p_closing_id: FECH, p_paid_at: '2026-11-05', p_method: 'pix',
    })
  })
  it('FECHAMENTO_JA_PAGO → 409', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'FECHAMENTO_JA_PAGO' } })
    const r = await pagar(post({ paidAt: '2026-11-05', paymentMethod: 'pix' }), ctxId(FECH))
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ error: 'Comissão já está paga' })
  })
  it('desfaz o pagamento; FECHAMENTO_NAO_PAGO → 409', async () => {
    expect((await desfazer(post(), ctxId(FECH))).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('undo_commission_payment', { p_clinic_id: CLINIC, p_closing_id: FECH })
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'FECHAMENTO_NAO_PAGO' } })
    const r = await desfazer(post(), ctxId(FECH))
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ error: 'Comissão não está paga' })
  })
})
