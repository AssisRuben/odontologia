import { describe, it, expect, vi } from 'vitest'
import { fakeAdmin, type Query } from '../fakeSupabase'
import { createKitsRepo } from '@/lib/kits/repo'

const CLINIC = '00000000-0000-4000-8000-0000000000c1'
const USER = '00000000-0000-4000-8000-0000000000a1'
const ID = '33333333-3333-4333-8333-333333333333'
const TR = '55555555-5555-4555-8555-555555555555'
const PAC = '66666666-6666-4666-8666-666666666666'

const ok = (data: unknown) => ({ data, error: null })
const temEq = (q: Query, col: string, val?: unknown) =>
  q.calls.some((c) => c[0] === 'eq' && c[1] === col && (val === undefined || c[2] === val))

describe('listar', () => {
  it('filtra por clínica, ordena por nome e usa o select dos itens', async () => {
    const c = fakeAdmin(() => ok([{ id: 'k' }]))
    const r = await createKitsRepo(c.admin).listar(CLINIC)
    const q = c.queries[0]
    expect(q.table).toBe('inventory_kits')
    expect(temEq(q, 'clinic_id', CLINIC)).toBe(true)
    expect(q.calls.find((x) => x[0] === 'select')?.[1]).toBe(
      '*, items:inventory_kit_items(id,item_id,quantity,item:inventory_items(id,name,unit,quantity,active))',
    )
    expect(q.calls.some((x) => x[0] === 'order' && x[1] === 'name')).toBe(true)
    expect(r).toEqual([{ id: 'k' }])
  })
})

describe('RPCs', () => {
  it('criar envia p_data com itens em snake_case', async () => {
    const rpc = vi.fn().mockResolvedValue(ok(ID))
    const r = await createKitsRepo({ rpc } as never).criar(CLINIC, {
      name: 'Resina', active: true, items: [{ itemId: ID, quantity: 2 }],
    })
    expect(r).toBe(ID)
    expect(rpc).toHaveBeenCalledWith('create_inventory_kit', {
      p_clinic_id: CLINIC,
      p_data: { name: 'Resina', active: true, items: [{ item_id: ID, quantity: 2 }] },
    })
  })
  it('baixar usa p_kit_id null e converte os itens', async () => {
    const rpc = vi.fn().mockResolvedValue(ok({ ok: true }))
    await createKitsRepo({ rpc } as never).baixar(CLINIC, USER, TR, { kitId: null, items: [{ itemId: ID, quantity: 3 }] })
    expect(rpc).toHaveBeenCalledWith('treatment_material_apply', {
      p_clinic_id: CLINIC, p_user_id: USER, p_treatment_id: TR, p_kit_id: null,
      p_items: [{ item_id: ID, quantity: 3 }],
    })
  })
  it('relança erro da rpc como { code, message }', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'P0001', message: 'KIT_VAZIO', details: 'd' } })
    await expect(createKitsRepo({ rpc } as never).devolver(CLINIC, USER, TR)).rejects.toEqual({
      code: 'P0001', message: 'KIT_VAZIO',
    })
  })
})

describe('material', () => {
  it('devolve null quando o tratamento não existe', async () => {
    const c = fakeAdmin(() => ok(null))
    expect(await createKitsRepo(c.admin).material(CLINIC, TR)).toBeNull()
    expect(temEq(c.queries[0], 'clinic_id', CLINIC)).toBe(true)
  })
  it('sugere o último kit usado no mesmo procedimento, mesmo havendo outro kit cujo nome casa', async () => {
    const kits = [
      { id: 'k-resina', name: 'Resina', active: true },
      { id: 'k-rest', name: 'Restauração Resina', active: true },
      { id: 'k-outro', name: 'Outro', active: true },
    ]
    const c = fakeAdmin((q, i) => {
      if (q.table === 'inventory_kits') return ok(kits)
      if (q.table === 'inventory_movements') return ok([{ id: 'm1' }])
      if (i === 0) {
        return ok({ id: TR, procedure: 'restauracao resina', status: 'completed', material_status: 'pendente', patient: { id: PAC, name: 'Ana' } })
      }
      return ok([
        { procedure: 'Limpeza', material_kit_id: 'k-outro' },
        { procedure: 'Restauração Resina', material_kit_id: 'k-rest' },
      ])
    })
    const r = await createKitsRepo(c.admin).material(CLINIC, TR)
    expect(r?.sugestao).toBe('k-rest')
    expect(r?.kits).toHaveLength(3)
    expect(r?.movimentos).toEqual([{ id: 'm1' }])
    const kitsQ = c.queries.find((q) => q.table === 'inventory_kits')!
    expect(temEq(kitsQ, 'active', true)).toBe(true)
    const mov = c.queries.find((q) => q.table === 'inventory_movements')!
    expect(temEq(mov, 'treatment_id', TR)).toBe(true)
    expect(temEq(mov, 'type', 'out')).toBe(true)
    expect(temEq(mov, 'clinic_id', CLINIC)).toBe(true)
  })
})

describe('pendentes', () => {
  it('filtra material pendente, concluído, paciente e clínica', async () => {
    const c = fakeAdmin(() => ok([{ id: 'a' }, { id: 'b' }]))
    expect(await createKitsRepo(c.admin).pendentes(CLINIC, PAC)).toEqual(['a', 'b'])
    const q = c.queries[0]
    expect(q.table).toBe('treatments')
    expect(temEq(q, 'material_status', 'pendente')).toBe(true)
    expect(temEq(q, 'status', 'completed')).toBe(true)
    expect(temEq(q, 'patient_id', PAC)).toBe(true)
    expect(temEq(q, 'clinic_id', CLINIC)).toBe(true)
  })
})
