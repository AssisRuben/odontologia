import { describe, it, expect, vi } from 'vitest'
import { fakeAdmin, type Query } from '../fakeSupabase'
import { createEstoqueRepo } from '@/lib/estoque/repo'
import type { EntradaInput, ProdutoInput } from '@/lib/estoque/validar'

const CLINIC = '00000000-0000-4000-8000-0000000000c1'
const USER = '00000000-0000-4000-8000-0000000000a1'
const ID = '33333333-3333-4333-8333-333333333333'
const LOTE = '44444444-4444-4444-8444-444444444444'

const ok = (data: unknown) => ({ data, error: null })
const temEq = (q: Query, col: string, val?: unknown) =>
  q.calls.some((c) => c[0] === 'eq' && c[1] === col && (val === undefined || c[2] === val))

describe('listar', () => {
  const linhas = [
    { id: 'b', name: 'Seringa', lots: [] },
    {
      id: 'a', name: 'Anestésico',
      lots: [
        { id: 'l1', clinic_id: CLINIC, quantity: 0 },
        { id: 'l2', clinic_id: CLINIC, quantity: 3 },
        { id: 'l3', clinic_id: 'outra-clinica', quantity: 9 },
      ],
    },
  ]
  it('filtra clínica e ativos, remove lotes zerados e ordena por nome', async () => {
    const c = fakeAdmin(() => ok(JSON.parse(JSON.stringify(linhas))))
    const r = await createEstoqueRepo(c.admin).listar(CLINIC, { inativos: false })
    const q = c.queries[0]
    expect(q.table).toBe('inventory_items')
    expect(temEq(q, 'clinic_id', CLINIC)).toBe(true)
    expect(temEq(q, 'active', true)).toBe(true)
    expect(q.calls.find((x) => x[0] === 'select')?.[1]).toContain('lots:inventory_lots(id,item_id,clinic_id,lot_code,expires_at,quantity,created_at)')
    expect(r.map((i) => i.id)).toEqual(['a', 'b'])
    expect(r[0].lots!.map((l) => l.id)).toEqual(['l2'])
  })
  it('com inativos não filtra active', async () => {
    const c = fakeAdmin(() => ok([]))
    await createEstoqueRepo(c.admin).listar(CLINIC, { inativos: true })
    expect(temEq(c.queries[0], 'active')).toBe(false)
  })
  it('propaga erro como { code, message }', async () => {
    const c = fakeAdmin(() => ({ data: null, error: { code: 'X', message: 'boom', details: 'd' } }))
    await expect(createEstoqueRepo(c.admin).listar(CLINIC, { inativos: false })).rejects.toEqual({ code: 'X', message: 'boom' })
  })
})

describe('RPCs', () => {
  const produto: ProdutoInput & { initialQuantity?: number; lotCode?: string | null; expiresAt?: string | null } = {
    name: 'Luvas', category: null, unit: 'cx', minQuantity: 2, idealQuantity: null, supplier: null, trackExpiry: true,
    initialQuantity: 5, lotCode: 'L1', expiresAt: '2027-01-01',
  }
  it('criar envia p_data em snake_case', async () => {
    const rpc = vi.fn().mockResolvedValue(ok(ID))
    expect(await createEstoqueRepo({ rpc } as never).criar(CLINIC, USER, produto)).toBe(ID)
    expect(rpc).toHaveBeenCalledWith('create_inventory_item', {
      p_clinic_id: CLINIC, p_user_id: USER,
      p_data: {
        name: 'Luvas', category: null, unit: 'cx', min_quantity: 2, ideal_quantity: null, supplier: null,
        tracks_expiry: true, initial_quantity: 5, lot_code: 'L1', expires_at: '2027-01-01',
      },
    })
  })
  it('editar manda todas as chaves', async () => {
    const rpc = vi.fn().mockResolvedValue(ok(null))
    await createEstoqueRepo({ rpc } as never).editar(CLINIC, ID, { ...produto, active: false })
    expect(rpc).toHaveBeenCalledWith('update_inventory_item', {
      p_clinic_id: CLINIC, p_id: ID,
      p_data: {
        name: 'Luvas', category: null, unit: 'cx', min_quantity: 2, ideal_quantity: null, supplier: null,
        active: false, tracks_expiry: true,
      },
    })
  })
  it('entrada converte centavos e pagamento para snake_case', async () => {
    const rpc = vi.fn().mockResolvedValue(ok({ quantity: 9, expense: { id: 'e1', amount: 1234.56, status: 'paid' } }))
    const i: EntradaInput = {
      quantity: 4, kind: 'compra', lotCode: 'L2', expiresAt: '2027-02-01', notes: null,
      totalCostCents: 123456, payment: { status: 'paid', method: 'pix', date: '2026-11-10' },
    }
    const r = await createEstoqueRepo({ rpc } as never).entrada(CLINIC, USER, ID, i)
    expect(r).toEqual({ quantity: 9, expense: { id: 'e1', amount: 1234.56, status: 'paid' } })
    expect(rpc).toHaveBeenCalledWith('inventory_entry', {
      p_clinic_id: CLINIC, p_user_id: USER, p_item_id: ID, p_quantity: 4, p_kind: 'compra',
      p_lot_code: 'L2', p_expires_at: '2027-02-01', p_notes: null, p_total_cost: 1234.56,
      p_payment: { status: 'paid', method: 'pix', date: '2026-11-10' },
    })
  })
  it('entrada pendente e sem custo', async () => {
    const rpc = vi.fn().mockResolvedValue(ok({ quantity: 1, expense: null }))
    const repo = createEstoqueRepo({ rpc } as never)
    const base: EntradaInput = { quantity: 1, kind: 'compra', lotCode: null, expiresAt: null, notes: null, totalCostCents: 5000, payment: { status: 'pending', dueDate: '2026-12-01' } }
    await repo.entrada(CLINIC, USER, ID, base)
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_total_cost: 50, p_payment: { status: 'pending', due_date: '2026-12-01' } })
    await repo.entrada(CLINIC, USER, ID, { ...base, kind: 'devolucao', totalCostCents: null, payment: null })
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_total_cost: null, p_payment: null })
  })
  it('saida, contagem e baixarLote passam os parâmetros', async () => {
    const rpc = vi.fn()
    const repo = createEstoqueRepo({ rpc } as never)
    rpc.mockResolvedValueOnce(ok({ quantity: 2, lotes: [{ lot_id: LOTE, lot_code: null, quantidade: 3 }] }))
    expect(await repo.saida(CLINIC, USER, ID, { quantity: 3, kind: 'uso', lotId: LOTE, notes: 'n' })).toEqual({
      quantity: 2, lotes: [{ lot_id: LOTE, lot_code: null, quantidade: 3 }],
    })
    expect(rpc).toHaveBeenLastCalledWith('inventory_exit', {
      p_clinic_id: CLINIC, p_user_id: USER, p_item_id: ID, p_quantity: 3, p_kind: 'uso', p_lot_id: LOTE, p_notes: 'n',
    })
    rpc.mockResolvedValueOnce(ok({ quantity: 7, diferenca: -1 }))
    expect(await repo.contagem(CLINIC, USER, ID, { counted: 7, lotId: null, notes: null })).toEqual({ quantity: 7, diferenca: -1 })
    expect(rpc).toHaveBeenLastCalledWith('inventory_count', {
      p_clinic_id: CLINIC, p_user_id: USER, p_item_id: ID, p_lot_id: null, p_counted: 7, p_notes: null,
    })
    rpc.mockResolvedValueOnce(ok({ quantity: 0, baixado: 4 }))
    expect(await repo.baixarLote(CLINIC, USER, LOTE)).toEqual({ quantity: 0, baixado: 4 })
    expect(rpc).toHaveBeenLastCalledWith('inventory_discard_lot', { p_clinic_id: CLINIC, p_user_id: USER, p_lot_id: LOTE })
  })
  it('erro de RPC vira { code, message }', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'P0001', message: 'ESTOQUE_INSUFICIENTE', hint: 'h' } })
    await expect(
      createEstoqueRepo({ rpc } as never).saida(CLINIC, USER, ID, { quantity: 1, kind: 'uso', lotId: null, notes: null }),
    ).rejects.toEqual({ code: 'P0001', message: 'ESTOQUE_INSUFICIENTE' })
  })
})

describe('movimentos', () => {
  it('filtra clínica, período (SP), produto e tipo; ordena e limita', async () => {
    const c = fakeAdmin(() => ok([{ id: 'm1' }]))
    const r = await createEstoqueRepo(c.admin).movimentos(CLINIC, { de: '2026-10-11', ate: '2026-11-10', produtoId: ID, tipo: 'out' })
    const q = c.queries[0]
    expect(q.table).toBe('inventory_movements')
    expect(temEq(q, 'clinic_id', CLINIC)).toBe(true)
    expect(temEq(q, 'item_id', ID)).toBe(true)
    expect(temEq(q, 'type', 'out')).toBe(true)
    expect(q.calls).toContainEqual(['gte', 'created_at', '2026-10-11T00:00:00-03:00'])
    expect(q.calls).toContainEqual(['lte', 'created_at', '2026-11-10T23:59:59.999-03:00'])
    expect(q.calls).toContainEqual(['order', 'created_at', { ascending: false }])
    expect(q.calls).toContainEqual(['limit', 500])
    expect(r).toEqual([{ id: 'm1' }])
  })
  it('sem produto/tipo não filtra', async () => {
    const c = fakeAdmin(() => ok([]))
    await createEstoqueRepo(c.admin).movimentos(CLINIC, { de: '2026-10-11', ate: '2026-11-10' })
    expect(temEq(c.queries[0], 'item_id')).toBe(false)
    expect(temEq(c.queries[0], 'type')).toBe(false)
  })
})
