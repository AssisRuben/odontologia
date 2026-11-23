import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fakeAdmin, type Query } from '../fakeSupabase'
import { createComissoesRepo } from '@/lib/comissoes/repo'
import { entradaPainel } from '@/lib/indicadores/repo'
import { loadFunnelSources } from '@/lib/orcamentos/repo'
import { loadPlanInput } from '@/lib/messaging/cycleData'
import { createConveniosRepo } from '@/lib/convenios/repo'

const CLINIC = '00000000-0000-4000-8000-0000000000c1'
const vazio = () => ({ data: [], error: null })

const filtraHistorico = (q: Query) => q.calls.some((c) => c[0] === 'is' && c[1] === 'imported_from' && c[2] === null)
const daTabela = (queries: Query[], tabela: string) => queries.filter((q) => q.table === tabela)

describe('isolamento do histórico importado', () => {
  it('comissões: tratamentos concluídos ignoram o importado', async () => {
    const { admin, queries } = fakeAdmin(vazio)
    await createComissoesRepo(admin).entradaCalculo(CLINIC)
    const t = daTabela(queries, 'treatments')
    expect(t).toHaveLength(1)
    expect(t.every(filtraHistorico)).toBe(true)
  })

  it('indicadores: consultas, tratamentos e pacientes da janela ignoram o importado', async () => {
    const { admin, queries } = fakeAdmin(vazio)
    await entradaPainel(admin, CLINIC, ['2026-10'])
    for (const tabela of ['appointments', 'treatments']) {
      const qs = daTabela(queries, tabela)
      expect(qs.length).toBeGreaterThan(0)
      expect(qs.every(filtraHistorico)).toBe(true)
    }
    const janela = daTabela(queries, 'patients').filter((q) => q.calls.some((c) => c[0] === 'gte' && c[1] === 'created_at'))
    expect(janela).toHaveLength(1)
    expect(janela.every(filtraHistorico)).toBe(true)
    // nomes do ranking não são filtrados
    const nomes = daTabela(queries, 'patients').filter((q) => q.calls.some((c) => c[0] === 'in'))
    expect(nomes.some(filtraHistorico)).toBe(false)
  })

  it('funil de orçamentos ignora o importado', async () => {
    const { admin, queries } = fakeAdmin(vazio)
    await loadFunnelSources(admin, CLINIC)
    expect(daTabela(queries, 'budgets')).toHaveLength(1)
    expect(daTabela(queries, 'budgets').every(filtraHistorico)).toBe(true)
  })

  it('lembretes automáticos: só as consultas concluídas ignoram o importado', async () => {
    const { admin, queries } = fakeAdmin(vazio)
    await loadPlanInput(admin, {
      clinicId: CLINIC, clinicName: 'Clínica', now: new Date('2026-11-22T12:00:00Z'), settings: [],
      cfg: {} as never,
    })
    const concluidas = daTabela(queries, 'appointments').filter((q) => q.calls.some((c) => c[0] === 'eq' && c[1] === 'status' && c[2] === 'completed'))
    expect(concluidas).toHaveLength(1)
    expect(concluidas.every(filtraHistorico)).toBe(true)
    const outras = daTabela(queries, 'appointments').filter((q) => !concluidas.includes(q))
    expect(outras.some(filtraHistorico)).toBe(false)
    expect(daTabela(queries, 'patients').some(filtraHistorico)).toBe(false)
  })

  it('convênios: tratamentos elegíveis para guia ignoram o importado', async () => {
    const { admin, queries } = fakeAdmin(vazio)
    const repo = createConveniosRepo({ ...admin, rpc: async () => ({ data: null, error: null }) } as unknown as SupabaseClient)
    await repo.tratamentosParaGuia(CLINIC, ['t1'])
    await repo.dadosPendencias(CLINIC, '2026-11-22')
    const t = daTabela(queries, 'treatments').filter((q) => q.calls.some((c) => c[0] === 'in' && c[1] === 'id') || q.calls.some((c) => c[0] === 'gte' && c[1] === 'completed_at'))
    expect(t).toHaveLength(2)
    expect(t.every(filtraHistorico)).toBe(true)
  })
})
