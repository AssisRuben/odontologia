import { describe, it, expect } from 'vitest'
import { buildFicha, type FichaInput } from '@/lib/ia/evolucao/ficha'
import { loadFichaInput } from '@/lib/ia/evolucao/repo'

const treat = (i: number, extra: Partial<FichaInput['treatments'][number]> = {}): FichaInput['treatments'][number] => ({
  id: `t-${i}`, procedure: 'Restauração', status: 'planned', date: '2026-10-01',
  teeth: [{ tooth_number: 36, faces: ['M', 'O'] }], ...extra,
})

describe('buildFicha', () => {
  it('monta linhas, apelidos e rótulos', () => {
    const input: FichaInput = {
      treatments: [treat(1)],
      budgetItems: [{ id: 'b-1', procedure: 'Canal', tooth: '46', status: 'pending', budget_date: '2026-10-12' }],
    }
    const { texto, refs } = buildFicha(input, '2026-11-06')
    expect(texto.split('\n')[0]).toBe('Hoje: 06/11/2026')
    expect(texto).toContain('T1 | Restauração | dentes 36 (M,O) | planejado')
    expect(texto).toContain('O1 | Canal | dente 46 | pendente | orçamento de 12/10/2026')
    expect(refs.get('T1')?.label).toBe('Restauração 36 MO')
    expect(refs.get('O1')).toMatchObject({ kind: 'item', id: 'b-1', status: 'pending', label: 'Canal 46', budgetDate: '2026-10-12' })
    expect(refs.get('T1')).toMatchObject({ kind: 'tratamento', id: 't-1', status: 'planned' })
  })

  it('não vaza campos fora de FichaInput', () => {
    const input = {
      treatments: [{ ...treat(1), name: 'Maria Silva', cpf: '123.456.789-00', phone: '11999990000' }],
      budgetItems: [],
    } as unknown as FichaInput
    const { texto } = buildFicha(input, '2026-11-06')
    for (const s of ['Maria Silva', '123.456.789-00', '11999990000']) expect(texto).not.toContain(s)
  })

  it('apelidos estáveis na ordem, mais recentes primeiro', () => {
    const input: FichaInput = {
      treatments: [treat(1, { date: '2026-09-01' }), treat(2, { date: '2026-10-01' }), treat(3, { date: '2026-10-01' })],
      budgetItems: [],
    }
    const { refs } = buildFicha(input, '2026-11-06')
    expect([1, 2, 3].map((n) => refs.get(`T${n}`)?.id)).toEqual(['t-2', 't-3', 't-1'])
  })

  it('limita a 50 de cada', () => {
    const input: FichaInput = {
      treatments: Array.from({ length: 60 }, (_, i) => treat(i)),
      budgetItems: Array.from({ length: 55 }, (_, i) => ({ id: `b-${i}`, procedure: 'X', tooth: null, status: 'in_progress' as const, budget_date: '2026-10-01' })),
    }
    const { refs, texto } = buildFicha(input, '2026-11-06')
    expect([...refs.keys()].filter((k) => k.startsWith('T'))).toHaveLength(50)
    expect([...refs.keys()].filter((k) => k.startsWith('O'))).toHaveLength(50)
    expect(texto).toContain('em andamento')
  })
})

function fakeAdmin(patientRows: unknown[]) {
  const result = (data: unknown[]) => {
    const q: Record<string, unknown> = {}
    const chain = () => q
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'range']) q[m] = chain
    q.maybeSingle = () => Promise.resolve({ data: data[0] ?? null, error: null })
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(res)
    return q
  }
  return { from: (t: string) => result(t === 'patients' ? patientRows : []) }
}

describe('loadFichaInput', () => {
  it('ficha null para paciente de outra clínica', async () => {
    const r = await loadFichaInput(fakeAdmin([]) as never, 'clinic-1', 'pat-1')
    expect(r).toBeNull()
  })
  it('ficha vazia para paciente da clínica sem itens', async () => {
    const r = await loadFichaInput(fakeAdmin([{ id: 'pat-1' }]) as never, 'clinic-1', 'pat-1')
    expect(r).toEqual({ treatments: [], budgetItems: [] })
  })
})
