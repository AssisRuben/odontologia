import { describe, it, expect, vi } from 'vitest'
import { fakeAdmin, type Query } from '../fakeSupabase'
import { createFluxoRepo } from '@/lib/fluxo/repo'

const CLINIC = '00000000-0000-4000-8000-0000000000c1'
const ok = (data: unknown) => ({ data, error: null })
const temEq = (q: Query, col: string, val?: unknown) =>
  q.calls.some((c) => c[0] === 'eq' && c[1] === col && (val === undefined || c[2] === val))

describe('dados', () => {
  it('filtra todas as consultas por clínica e converte reais em centavos', async () => {
    const c = fakeAdmin((q) =>
      ok(
        q.table === 'payments'
          ? [{ id: 'p', amount: 123.45, net_amount: null, status: 'paid', due_date: null, paid_at: '2026-11-01T12:00:00Z', description: 'x', patient: { name: 'Ana' } }]
          : [{ id: 'e', amount: 10.1, status: 'pending', due_date: '2026-11-20', paid_at: null, description: 'Luz', recurrence_id: 'r' }],
      ),
    )
    const r = await createFluxoRepo(c.admin).dados(CLINIC, { inicio: '2026-09-01', fim: '2027-04-30' }, '2026-09-01')
    expect(c.queries.length).toBeGreaterThanOrEqual(2)
    for (const q of c.queries) expect(temEq(q, 'clinic_id', CLINIC)).toBe(true)
    expect(r.pagamentos[0]).toMatchObject({ valorCentavos: 12345, liquidoCentavos: null, descricao: 'Ana' })
    expect(r.despesas[0]).toMatchObject({ valorCentavos: 1010, recorrente: true, descricao: 'Luz' })
    expect(c.queries.some((q) => q.calls.some((x) => x[0] === 'gte' && x[2] === '2026-09-01T00:00:00-03:00'))).toBe(true)
  })
})

describe('criarRecorrencia', () => {
  it('chama a rpc com valores em reais e mês no dia 1', async () => {
    const rpc = vi.fn().mockResolvedValue(ok('id1'))
    const r = await createFluxoRepo({ rpc } as never).criarRecorrencia(CLINIC, {
      description: 'Aluguel', amountCentavos: 15000, category: 'aluguel', deductionGroup: null,
      paymentMethod: null, dayOfMonth: 5, startMonth: '2026-11', endMonth: null,
    })
    expect(r).toBe('id1')
    expect(rpc).toHaveBeenCalledWith('create_expense_recurrence', {
      p_clinic_id: CLINIC,
      p_data: {
        description: 'Aluguel', amount: 150, category: 'aluguel', deduction_group: null,
        payment_method: null, day_of_month: 5, start_month: '2026-11-01', end_month: null,
      },
    })
  })
})

describe('saldoAtual', () => {
  it('ordena por data e criação desc, limite 1', async () => {
    const c = fakeAdmin(() => ok([{ balance_date: '2026-11-01', amount: -5.5 }]))
    const r = await createFluxoRepo(c.admin).saldoAtual(CLINIC)
    const q = c.queries[0]
    expect(q.table).toBe('cash_balances')
    expect(temEq(q, 'clinic_id', CLINIC)).toBe(true)
    const orders = q.calls.filter((x) => x[0] === 'order')
    expect(orders[0].slice(1, 3)).toEqual(['balance_date', { ascending: false }])
    expect(orders[1].slice(1, 3)).toEqual(['created_at', { ascending: false }])
    expect(q.calls.some((x) => x[0] === 'limit' && x[1] === 1)).toBe(true)
    expect(r).toEqual({ data: '2026-11-01', valorCentavos: -550 })
  })
  it('null sem saldo', async () => {
    const c = fakeAdmin(() => ok([]))
    expect(await createFluxoRepo(c.admin).saldoAtual(CLINIC)).toBeNull()
  })
})

describe('dados: paginação e filtros', () => {
  const linha = (i: number) => ({ id: `e${i}`, amount: 1, status: 'pending', due_date: '2026-11-20', paid_at: null, description: 'd', recurrence_id: null })

  it('pede a página seguinte enquanto vier página cheia e concatena', async () => {
    const pagina = new Map<number, number>()
    const c = fakeAdmin((q) => {
      if (q.table !== 'expenses' || !q.calls.some((x) => x[0] === 'eq' && x[1] === 'status' && x[2] === 'pending') && !q.calls.some((x) => x[0] === 'in')) return ok([])
      const r = q.calls.find((x) => x[0] === 'range') as [string, number, number]
      pagina.set(r[1], r[2])
      return ok(r[1] === 0 ? Array.from({ length: 1000 }, (_, i) => linha(i)) : [linha(1000)])
    })
    const r = await createFluxoRepo(c.admin).dados(CLINIC, { inicio: '2026-09-01', fim: '2027-04-30' }, '2026-09-01')
    expect([...pagina.entries()]).toEqual([[0, 999], [1000, 1999]])
    expect(r.despesas).toHaveLength(1001)
    expect(c.queries.every((q) => q.calls.some((x) => x[0] === 'order' && x[1] === 'id'))).toBe(true)
  })

  it('consultas de não pagos filtram status e vencimento até o fim da janela', async () => {
    const c = fakeAdmin(() => ok([]))
    await createFluxoRepo(c.admin).dados(CLINIC, { inicio: '2026-09-01', fim: '2027-04-30' }, '2026-09-01')
    const abertas = c.queries.filter((q) => q.calls.some((x) => x[0] === 'in'))
    expect(abertas.map((q) => q.table).sort()).toEqual(['expenses', 'payments'])
    for (const q of abertas) {
      expect(q.calls.some((x) => x[0] === 'in' && x[1] === 'status' && JSON.stringify(x[2]) === '["pending","overdue"]')).toBe(true)
      if (q.table === 'expenses') {
        expect(q.calls.some((x) => x[0] === 'or' && x[1] === 'due_date.is.null,due_date.lte.2027-04-30')).toBe(true)
      } else {
        expect(q.calls.some((x) => x[0] === 'lte' && x[1] === 'due_date' && x[2] === '2027-04-30')).toBe(true)
      }
    }
  })
})
