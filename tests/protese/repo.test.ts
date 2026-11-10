import { describe, it, expect, vi } from 'vitest'
import { fakeAdmin, type Query } from '../fakeSupabase'
import { createProteseRepo } from '@/lib/protese/repo'
import type { ProteseInput } from '@/lib/protese/validar'

const CLINIC = '00000000-0000-4000-8000-0000000000c1'
const USER = '00000000-0000-4000-8000-0000000000u1'
const PAC = '22222222-2222-4222-8222-222222222222'
const ID = '33333333-3333-4333-8333-333333333333'
const HOJE = '2026-11-10'

const ok = (data: unknown) => ({ data, error: null })
const temEq = (q: Query, col: string, val?: unknown) =>
  q.calls.some((c) => c[0] === 'eq' && c[1] === col && (val === undefined || c[2] === val))

const input: ProteseInput = {
  patientId: PAC, professionalId: null, laboratoryId: null, type: 'Coroa',
  toothRegion: '11', expectedAt: '2026-11-20', labCostCents: 35050, notes: null,
}

describe('listar', () => {
  const linhas = [
    {
      id: 'a', status: 'installed', requested_at: '2026-08-01T10:00:00Z',
      events: [{ id: 'e1', to_status: 'installed', created_at: '2026-08-05T10:00:00Z' }],
    },
    {
      id: 'b', status: 'requested', requested_at: '2026-11-01T10:00:00Z',
      events: [
        { id: 'e3', to_status: 'sent_to_lab', created_at: '2026-11-03T10:00:00Z' },
        { id: 'e2', to_status: 'requested', created_at: '2026-11-01T10:00:00Z' },
      ],
    },
  ]

  it('filtra por clínica, esconde instaladas antigas e ordena eventos', async () => {
    const c = fakeAdmin(() => ok(JSON.parse(JSON.stringify(linhas))))
    const r = await createProteseRepo(c.admin).listar(CLINIC, { todas: false, hojeYmd: HOJE })
    expect(c.queries[0].table).toBe('prosthetics')
    expect(temEq(c.queries[0], 'clinic_id', CLINIC)).toBe(true)
    expect(temEq(c.queries[0], 'patient_id')).toBe(false)
    expect(c.queries[0].calls).toContainEqual(['order', 'requested_at', { ascending: false }])
    expect(r.map((p) => p.id)).toEqual(['b'])
    expect(r[0].events!.map((e) => e.id)).toEqual(['e2', 'e3'])
  })
  it('com "todas" mostra as antigas', async () => {
    const c = fakeAdmin(() => ok(JSON.parse(JSON.stringify(linhas))))
    const r = await createProteseRepo(c.admin).listar(CLINIC, { todas: true, hojeYmd: HOJE })
    expect(r.map((p) => p.id)).toEqual(['a', 'b'])
  })
  it('com paciente não filtra instaladas antigas', async () => {
    const c = fakeAdmin(() => ok(JSON.parse(JSON.stringify(linhas))))
    const r = await createProteseRepo(c.admin).listar(CLINIC, { pacienteId: PAC, todas: false, hojeYmd: HOJE })
    expect(temEq(c.queries[0], 'patient_id', PAC)).toBe(true)
    expect(r.map((p) => p.id)).toEqual(['a', 'b'])
  })
  it('propaga erro como { code, message }', async () => {
    const c = fakeAdmin(() => ({ data: null, error: { code: 'X', message: 'boom', details: 'd' } }))
    await expect(createProteseRepo(c.admin).listar(CLINIC, { todas: true, hojeYmd: HOJE })).rejects.toEqual({ code: 'X', message: 'boom' })
  })
})

describe('RPCs', () => {
  it('criar envia p_data em snake_case com lab_cost em reais', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: ID, error: null })
    expect(await createProteseRepo({ rpc } as never).criar(CLINIC, USER, input)).toBe(ID)
    expect(rpc).toHaveBeenCalledWith('create_prosthetic', {
      p_clinic_id: CLINIC, p_user_id: USER,
      p_data: {
        patient_id: PAC, professional_id: null, laboratory_id: null, type: 'Coroa',
        tooth_region: '11', expected_at: '2026-11-20', lab_cost: 350.5, notes: null,
      },
    })
  })
  it('criar sem custo envia lab_cost null', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: ID, error: null })
    await createProteseRepo({ rpc } as never).criar(CLINIC, USER, { ...input, labCostCents: null })
    expect(rpc.mock.calls[0][1].p_data.lab_cost).toBeNull()
  })
  it('editar envia as 8 chaves', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { expense: null, aviso: null }, error: null })
    const r = await createProteseRepo({ rpc } as never).editar(CLINIC, ID, input)
    expect(r).toEqual({ expense: null, aviso: null })
    expect(rpc.mock.calls[0][0]).toBe('update_prosthetic')
    expect(rpc.mock.calls[0][1].p_id).toBe(ID)
    expect(Object.keys(rpc.mock.calls[0][1].p_data).sort()).toEqual(
      ['expected_at', 'laboratory_id', 'lab_cost', 'notes', 'patient_id', 'professional_id', 'tooth_region', 'type'].sort(),
    )
  })
  it('mover passa de/para/observação/previsão', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'sent_to_lab', expense: null }, error: null })
    const r = await createProteseRepo({ rpc } as never).mover(CLINIC, USER, ID, {
      de: 'requested', para: 'sent_to_lab', observacao: 'ok', previsao: '2026-11-20',
    })
    expect(r.status).toBe('sent_to_lab')
    expect(rpc).toHaveBeenCalledWith('move_prosthetic', {
      p_clinic_id: CLINIC, p_user_id: USER, p_id: ID,
      p_from: 'requested', p_to: 'sent_to_lab', p_note: 'ok', p_expected_at: '2026-11-20',
    })
  })
  it('excluir devolve o destino da despesa', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { despesa: 'apagada' }, error: null })
    expect(await createProteseRepo({ rpc } as never).excluir(CLINIC, ID)).toEqual({ despesa: 'apagada' })
    expect(rpc).toHaveBeenCalledWith('delete_prosthetic', { p_clinic_id: CLINIC, p_id: ID })
  })
  it('erro de RPC vira { code, message }', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'P0001', message: 'PROTESE_CONFLITO', details: 'x' } })
    await expect(
      createProteseRepo({ rpc } as never).mover(CLINIC, USER, ID, { de: 'requested', para: 'returned', observacao: null, previsao: null }),
    ).rejects.toEqual({ code: 'P0001', message: 'PROTESE_CONFLITO' })
  })
})

describe('laboratorios', () => {
  it('lista por nome e soma emAndamento', async () => {
    const c = fakeAdmin((q) => {
      if (q.table === 'laboratories') return ok([{ id: 'l1', name: 'A', active: true }, { id: 'l2', name: 'B', active: true }])
      return ok([{ laboratory_id: 'l1' }, { laboratory_id: 'l1' }, { laboratory_id: null }, { laboratory_id: 'l2' }])
    })
    const r = await createProteseRepo(c.admin).laboratorios(CLINIC)
    expect(r.map((l) => [l.id, l.emAndamento])).toEqual([['l1', 2], ['l2', 1]])
    for (const q of c.queries) expect(temEq(q, 'clinic_id', CLINIC)).toBe(true)
    const p = c.queries.find((q) => q.table === 'prosthetics')!
    expect(p.calls).toContainEqual(['neq', 'status', 'installed'])
  })
  it('criarLaboratorio insere com clinic_id', async () => {
    const c = fakeAdmin(() => ok({ id: 'l1', name: 'A' }))
    const r = await createProteseRepo(c.admin).criarLaboratorio(CLINIC, { name: 'A', phone: null, notes: null })
    expect(r).toEqual({ id: 'l1', name: 'A' })
    expect(c.queries[0].calls).toContainEqual(['insert', { clinic_id: CLINIC, name: 'A', phone: null, notes: null }])
  })
  it('criarLaboratorio propaga 23505', async () => {
    const c = fakeAdmin(() => ({ data: null, error: { code: '23505', message: 'dup' } }))
    await expect(createProteseRepo(c.admin).criarLaboratorio(CLINIC, { name: 'A', phone: null, notes: null })).rejects.toEqual({ code: '23505', message: 'dup' })
  })
  it('editarLaboratorio devolve false sem linhas e true com linha', async () => {
    const vazio = fakeAdmin(() => ok([]))
    expect(await createProteseRepo(vazio.admin).editarLaboratorio(CLINIC, 'l1', { name: 'B' })).toBe(false)
    const um = fakeAdmin(() => ok([{ id: 'l1' }]))
    expect(await createProteseRepo(um.admin).editarLaboratorio(CLINIC, 'l1', { active: false })).toBe(true)
    expect(temEq(um.queries[0], 'clinic_id', CLINIC)).toBe(true)
    expect(temEq(um.queries[0], 'id', 'l1')).toBe(true)
    expect(um.queries[0].calls).toContainEqual(['update', { active: false }])
  })
})
