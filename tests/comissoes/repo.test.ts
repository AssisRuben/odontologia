import { describe, it, expect, vi } from 'vitest'
import { fakeAdmin, type Query } from '../fakeSupabase'
import { createComissoesRepo } from '@/lib/comissoes/repo'
import { lerTudo } from '@/lib/supabase/lerTudo'

const CLINIC = '00000000-0000-4000-8000-0000000000c1'
const PROF = '11111111-1111-4111-8111-111111111111'
const PAC = '22222222-2222-4222-8222-222222222222'

const ok = (data: unknown) => ({ data, error: null })
const faixa = (q: Query) => q.calls.find((c) => c[0] === 'range') as [string, number, number] | undefined
const temEq = (q: Query, col: string, val?: unknown) =>
  q.calls.some((c) => c[0] === 'eq' && c[1] === col && (val === undefined || c[2] === val))

describe('lerTudo', () => {
  it('pagina até receber uma página incompleta', async () => {
    const faixas: [number, number][] = []
    const r = await lerTudo<number>(async (de, ate) => {
      faixas.push([de, ate])
      return { data: Array.from({ length: de === 0 ? 1000 : 1 }, (_, i) => i), error: null }
    })
    expect(r).toHaveLength(1001)
    expect(faixas).toEqual([[0, 999], [1000, 1999]])
  })
  it('propaga o erro', async () => {
    await expect(lerTudo(async () => ({ data: null, error: { message: 'boom' } }))).rejects.toThrow('boom')
  })
})

describe('entradaCalculo', () => {
  function cenario(extra: (q: Query) => unknown = () => undefined) {
    return fakeAdmin((q) => {
      const x = extra(q)
      if (x !== undefined) return x
      switch (q.table) {
        case 'payments':
          return ok([
            { id: 'p1', patient_id: PAC, amount: '100.00', net_amount: '97.50', payment_method: 'pix', paid_at: '2026-10-05T12:00:00Z', created_at: '2026-10-05T12:00:01Z' },
            { id: 'p2', patient_id: PAC, amount: 50, net_amount: null, payment_method: 'convenio', paid_at: '2026-10-20T12:00:00Z', created_at: 'c' },
            { id: 'p3', patient_id: PAC, amount: 10, net_amount: null, payment_method: 'pix', paid_at: null, created_at: 'c' },
          ])
        case 'treatments':
          return ok([
            { id: 't1', patient_id: PAC, professional_id: PROF, procedure: 'Limpeza', value: '100', completed_at: '2026-10-04', created_at: 'c' },
            { id: 't2', patient_id: PAC, professional_id: PROF, procedure: 'Canal', value: 80, completed_at: '2026-10-06', created_at: 'c' },
          ])
        case 'insurance_guide_items':
          return ok([])
        case 'expenses':
          return ok([
            { id: 'e1', professional_id: PROF, description: 'Prótese', amount: '30.5', paid_at: '2026-10-10T12:00:00Z' },
            { id: 'e2', professional_id: PROF, description: 'Sem data', amount: 10, paid_at: null },
          ])
        case 'professionals':
          return ok([{ id: PROF, name: 'Ana', commission_rate: '40.00', commission_rate_insurance: null }])
        case 'commission_closings':
          return ok([
            { id: 'f1', professional_id: PROF, period: '2026-09-01', amount: '408.10', status: 'fechado', closed_at: 'x', paid_at: null, payment_method: null, statement: { totalCentavos: 40810 } },
          ])
        case 'patients':
          return ok([{ id: PAC, name: 'Bia' }])
      }
      return ok([])
    })
  }

  it('lê só dados da clínica, converte para centavos/datas e marca tratamentos em guia', async () => {
    const c = cenario((q) => {
      if (q.table === 'insurance_guide_items') {
        if (temEq(q, 'active', true)) return ok([{ treatment_id: 't2' }])
        return ok([
          {
            id: 'i1', name: 'Restauração', paid_value: '90', recovered_value: null, payment_id: 'p2', recovered_payment_id: null,
            treatment: { professional_id: null }, guide: { patient_id: PAC, professional_id: PROF },
          },
        ])
      }
      return undefined
    })
    const e = await createComissoesRepo(c.admin).entradaCalculo(CLINIC)

    for (const q of c.queries) expect(temEq(q, 'clinic_id', CLINIC)).toBe(true)
    expect(c.queries.map((q) => q.table).sort()).toEqual(
      ['commission_closings', 'expenses', 'insurance_guide_items', 'insurance_guide_items', 'patients', 'payments', 'professionals', 'treatments'],
    )

    // p3 sem data é ignorado; p2 (convênio) continua na lista para os itens
    expect(e.recebimentos.map((r) => r.id)).toEqual(['p1', 'p2'])
    expect(e.recebimentos[0]).toMatchObject({ amount: 100, net_amount: 97.5, paid_at: '2026-10-05' })
    expect(e.tratamentos.map((t) => [t.id, t.em_guia])).toEqual([['t1', false], ['t2', true]])
    expect(e.itensConvenio).toEqual([
      { item_id: 'i1', patient_id: PAC, professional_id: PROF, descricao: 'Restauração', paid_value: 90, pago_em: '2026-10-20', recovered_value: null, recuperado_em: null },
    ])
    expect(e.laboratorio).toEqual([{ id: 'e1', professional_id: PROF, description: 'Prótese', amount: 30.5, paid_at: '2026-10-10' }])
    expect(e.profissionais).toEqual([{ id: PROF, name: 'Ana', commission_rate: 40, commission_rate_insurance: null }])
    expect(e.fechamentos[0]).toMatchObject({ period: '2026-09-01', amountCentavos: 40810, status: 'fechado' })
    expect(e.nomesPacientes).toEqual({ [PAC]: 'Bia' })

    const q = (t: string) => c.queries.find((x) => x.table === t)!
    expect(temEq(q('payments'), 'status', 'paid')).toBe(true)
    expect(temEq(q('treatments'), 'status', 'completed')).toBe(true)
    expect(temEq(q('expenses'), 'category', 'laboratorio')).toBe(true)
    expect(temEq(q('expenses'), 'status', 'paid')).toBe(true)
  })

  it('pagina as leituras (1000 + 1 linhas)', async () => {
    const linha = (i: number) => ({
      id: `p${i}`, patient_id: PAC, amount: 1, net_amount: null, payment_method: 'pix', paid_at: '2026-10-05T12:00:00Z', created_at: 'c',
    })
    const c = fakeAdmin((q) => {
      if (q.table !== 'payments') return ok([])
      const [, de] = faixa(q)!
      return ok(de === 0 ? Array.from({ length: 1000 }, (_, i) => linha(i)) : [linha(1000)])
    })
    const e = await createComissoesRepo(c.admin).entradaCalculo(CLINIC)
    expect(e.recebimentos).toHaveLength(1001)
    expect(c.queries.filter((q) => q.table === 'payments').map((q) => faixa(q)!.slice(1))).toEqual([[0, 999], [1000, 1999]])
  })

  it('propaga erro de leitura', async () => {
    const c = fakeAdmin(() => ({ data: null, error: { message: 'boom' } }))
    await expect(createComissoesRepo(c.admin).entradaCalculo(CLINIC)).rejects.toThrow('boom')
  })
})

describe('profissional', () => {
  it('filtra por clínica e devolve null quando não existe', async () => {
    const c = fakeAdmin(() => ok(null))
    expect(await createComissoesRepo(c.admin).profissional(CLINIC, PROF)).toBeNull()
    expect(temEq(c.queries[0], 'clinic_id', CLINIC)).toBe(true)
    expect(temEq(c.queries[0], 'id', PROF)).toBe(true)
  })
})

describe('RPCs', () => {
  const extrato = { totalCentavos: 40800 } as never
  it('fecharMes envia período no dia 1 e valor em reais', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'cid', error: null })
    const id = await createComissoesRepo({ rpc } as never).fecharMes(CLINIC, PROF, '2026-10', extrato)
    expect(id).toBe('cid')
    expect(rpc).toHaveBeenCalledWith('close_commission', {
      p_clinic_id: CLINIC, p_professional_id: PROF, p_period: '2026-10-01', p_amount: 408, p_statement: extrato,
    })
  })
  it('pagar, reabrir e desfazer chamam a função certa', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'eid', error: null })
    const repo = createComissoesRepo({ rpc } as never)
    expect(await repo.pagar(CLINIC, 'f', '2026-11-05', 'pix')).toBe('eid')
    await repo.reabrir(CLINIC, 'f')
    await repo.desfazerPagamento(CLINIC, 'f')
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(['pay_commission', 'reopen_commission', 'undo_commission_payment'])
    expect(rpc.mock.calls[0][1]).toEqual({ p_clinic_id: CLINIC, p_closing_id: 'f', p_paid_at: '2026-11-05', p_method: 'pix' })
  })
  it('lança { code, message } em erro', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'P0001', message: 'MES_ABERTO', details: 'x' } })
    await expect(createComissoesRepo({ rpc } as never).reabrir(CLINIC, 'f')).rejects.toEqual({ code: 'P0001', message: 'MES_ABERTO' })
  })
})
