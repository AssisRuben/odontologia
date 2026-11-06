import { describe, it, expect } from 'vitest'
import { validarSugestoes, isFdi, normalizarFaces, dataRetorno } from '@/lib/ia/evolucao/sugestoes'
import type { Ref } from '@/lib/ia/evolucao/ficha'

const refs = new Map<string, Ref>([
  ['O1', { kind: 'item', id: 'uuid-o1', status: 'pending', label: 'Restauração 36 MO', budgetDate: '2026-10-12' }],
  ['O2', { kind: 'item', id: 'uuid-o2', status: 'in_progress', label: 'Canal 46', budgetDate: '2026-10-12' }],
  ['T1', { kind: 'tratamento', id: 'uuid-t1', status: 'planned', label: 'Canal 46' }],
  ['T2', { kind: 'tratamento', id: 'uuid-t2', status: 'in_progress', label: 'Limpeza' }],
])

const base = { ref: null, novo_status: null, procedimento: null, dentes: null, faces: null, status: null, dias: null, motivo: null }
const s = (o: Record<string, unknown>) => ({ ...base, ...o })
const v = (o: Record<string, unknown>[]) => validarSugestoes(o as never, refs)

describe('validarSugestoes', () => {
  it('traduz para UUID com descrição exata', () => {
    const r = v([
      s({ tipo: 'item_orcamento', ref: 'O1', novo_status: 'completed' }),
      s({ tipo: 'item_orcamento', ref: 'O2', novo_status: 'completed' }),
      s({ tipo: 'tratamento', ref: 'T1', novo_status: 'completed' }),
      s({ tipo: 'tratamento', ref: 'T2', novo_status: 'completed' }),
    ])
    expect(r.map((x) => x.descricao)).toEqual([
      'Concluir Restauração 36 MO (orçamento de 12/10/2026)',
      'Concluir Canal 46 (orçamento de 12/10/2026)',
      'Concluir tratamento Canal 46',
      'Concluir tratamento Limpeza',
    ])
    expect(r[0].acao).toEqual({ tipo: 'item_orcamento', id: 'uuid-o1', novo_status: 'completed' })
    expect(r[2].acao).toEqual({ tipo: 'tratamento', id: 'uuid-t1', novo_status: 'completed' })
  })

  it('descrições de iniciar e marcar em andamento', () => {
    const r = v([
      s({ tipo: 'item_orcamento', ref: 'O1', novo_status: 'in_progress' }),
      s({ tipo: 'tratamento', ref: 'T1', novo_status: 'in_progress' }),
    ])
    expect(r[0].descricao).toBe('Iniciar Restauração 36 MO (orçamento de 12/10/2026)')
    expect(r[1].descricao).toBe('Marcar em andamento: tratamento Canal 46')
  })

  it('descarta ref inexistente, tipo trocado, sem avanço e repetida', () => {
    expect(v([s({ tipo: 'item_orcamento', ref: 'O9', novo_status: 'completed' })])).toEqual([])
    expect(v([s({ tipo: 'tratamento', ref: 'O1', novo_status: 'completed' })])).toEqual([])
    expect(v([s({ tipo: 'item_orcamento', ref: 'T1', novo_status: 'completed' })])).toEqual([])
    expect(v([s({ tipo: 'item_orcamento', ref: 'O2', novo_status: 'in_progress' })])).toEqual([])
    expect(v([s({ tipo: 'item_orcamento', ref: null, novo_status: 'completed' })])).toEqual([])
    expect(v([s({ tipo: 'item_orcamento', ref: 'O1', novo_status: null })])).toEqual([])
    const r = v([
      s({ tipo: 'item_orcamento', ref: 'O1', novo_status: 'in_progress' }),
      s({ tipo: 'item_orcamento', ref: 'O1', novo_status: 'completed' }),
    ])
    expect(r).toHaveLength(1)
    expect(r[0].acao).toMatchObject({ novo_status: 'in_progress' })
  })

  it('tratamento_novo: válido e descrições', () => {
    const r = v([
      s({ tipo: 'tratamento_novo', procedimento: 'Profilaxia', dentes: [], faces: [], status: 'completed' }),
      s({ tipo: 'tratamento_novo', procedimento: ' Restauração ', dentes: [46], faces: ['o'], status: 'planned' }),
    ])
    expect(r[0].descricao).toBe('Lançar tratamento: Profilaxia (concluído)')
    expect(r[1].descricao).toBe('Lançar tratamento: Restauração — 46 O (planejado)')
    expect(r[1].acao).toEqual({ tipo: 'tratamento_novo', procedimento: 'Restauração', dentes: [46], faces: ['O'], status: 'planned' })
  })

  it('tratamento_novo: descarta dente, face, procedimento e status inválidos', () => {
    const n = (o: Record<string, unknown>) => v([s({ tipo: 'tratamento_novo', procedimento: 'X', dentes: [], faces: [], status: 'completed', ...o })])
    expect(n({ dentes: [19] })).toEqual([])
    expect(n({ dentes: [99] })).toEqual([])
    expect(n({ dentes: [46, 99] })).toEqual([])
    expect(n({ faces: ['X'] })).toEqual([])
    expect(n({ procedimento: '   ' })).toEqual([])
    expect(n({ procedimento: null })).toEqual([])
    expect(n({ status: null })).toEqual([])
    expect(n({})).toHaveLength(1)
  })

  it('corta procedimento em 200 caracteres', () => {
    const r = v([s({ tipo: 'tratamento_novo', procedimento: 'a'.repeat(300), dentes: [], faces: [], status: 'planned' })])
    expect((r[0].acao as { procedimento: string }).procedimento).toHaveLength(200)
  })

  it('retorno: limites, descrição e só o primeiro', () => {
    expect(v([s({ tipo: 'retorno', dias: 0, motivo: 'a' })])).toEqual([])
    expect(v([s({ tipo: 'retorno', dias: 400, motivo: 'a' })])).toEqual([])
    expect(v([s({ tipo: 'retorno', dias: 1.5, motivo: 'a' })])).toEqual([])
    const r = v([
      s({ tipo: 'retorno', dias: 15, motivo: 'remover a sutura' }),
      s({ tipo: 'retorno', dias: 30, motivo: 'revisão' }),
    ])
    expect(r).toHaveLength(1)
    expect(r[0].acao).toEqual({ tipo: 'retorno', dias: 15, motivo: 'remover a sutura' })
    expect(r[0].descricao).toBe('Retorno em 15 dias: remover a sutura')
  })
})

describe('auxiliares', () => {
  it('isFdi', () => {
    for (const n of [11, 18, 28, 31, 48, 51, 55, 65, 71, 85]) expect(isFdi(n)).toBe(true)
    for (const n of [0, 19, 29, 56, 66, 76, 86, 99, 4.5]) expect(isFdi(n)).toBe(false)
  })
  it('normalizarFaces', () => {
    expect(normalizarFaces(['m', 'O', 'M'])).toEqual(['M', 'O'])
    expect(normalizarFaces(['X'])).toBeNull()
    expect(normalizarFaces([])).toEqual([])
  })
  it('dataRetorno', () => {
    expect(dataRetorno('2026-12-25', 15)).toBe('2027-01-09')
    expect(dataRetorno('2028-02-20', 10)).toBe('2028-03-01')
  })
})
