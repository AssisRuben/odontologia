import { describe, it, expect } from 'vitest'
import { montarPendencias } from '@/lib/convenios/pendencias'

const hoje = '2026-03-10'
const vazio = { hoje, guias: [], tratamentos: [], lotes: [], operadorasSemFechamento: [] }
const guia = {
  id: 'g1', patient_id: 'p1', patient_name: 'Ana', plan_name: 'Uniodonto',
  status: 'aguardando' as const, requested_at: '2026-03-02', password_valid_until: null, temItemSemLote: true,
}
const lote = { id: 'l1', plan_name: 'Uniodonto', period_end: '2026-03-10', status: 'aberto' as const, due_date: '2026-03-13' }

describe('montarPendencias', () => {
  it('guia com 8 dias entra e com 7 não', () => {
    const r = montarPendencias({ ...vazio, guias: [guia] })
    expect(r.itens).toEqual([{
      tipo: 'guia_aguardando',
      texto: 'Guia de Ana (Uniodonto) aguardando autorização há 8 dias',
      href: '/pacientes/p1?aba=tratamentos',
    }])
    expect(montarPendencias({ ...vazio, guias: [{ ...guia, requested_at: '2026-03-03' }] }).itens).toEqual([])
  })
  it('guia não aguardando não gera guia_aguardando', () => {
    expect(montarPendencias({ ...vazio, guias: [{ ...guia, status: 'liberada' }] }).itens).toEqual([])
  })
  it('senha vencendo, vencida e fora do limite', () => {
    const g = { ...guia, status: 'liberada' as const }
    expect(montarPendencias({ ...vazio, guias: [{ ...g, password_valid_until: '2026-03-17' }] }).itens[0].texto)
      .toBe('Senha da guia de Ana vence em 17/03')
    expect(montarPendencias({ ...vazio, guias: [{ ...g, password_valid_until: '2026-03-09' }] }).itens[0].texto)
      .toBe('Senha da guia de Ana venceu em 09/03')
    expect(montarPendencias({ ...vazio, guias: [{ ...g, password_valid_until: '2026-03-18' }] }).itens).toEqual([])
  })
  it('senha só entra com item sem lote e guia não cancelada', () => {
    const g = { ...guia, status: 'liberada' as const, password_valid_until: '2026-03-11' }
    expect(montarPendencias({ ...vazio, guias: [{ ...g, temItemSemLote: false }] }).itens).toEqual([])
    expect(montarPendencias({ ...vazio, guias: [{ ...g, status: 'cancelada' }] }).itens).toEqual([])
  })
  it('lote com prazo em 3 dias entra e 4 não', () => {
    expect(montarPendencias({ ...vazio, lotes: [lote] }).itens[0]).toEqual({
      tipo: 'lote_prazo',
      texto: 'Lote Uniodonto 03/2026: prazo em 3 dias',
      href: '/convenios?aba=lotes&lote=l1',
    })
    expect(montarPendencias({ ...vazio, lotes: [{ ...lote, due_date: '2026-03-14' }] }).itens).toEqual([])
  })
  it('prazo hoje, vencido e lote enviado', () => {
    expect(montarPendencias({ ...vazio, lotes: [{ ...lote, due_date: hoje }] }).itens[0].texto)
      .toBe('Lote Uniodonto 03/2026: prazo hoje')
    expect(montarPendencias({ ...vazio, lotes: [{ ...lote, due_date: '2026-03-08' }] }).itens[0].texto)
      .toBe('Lote Uniodonto 03/2026: prazo vencido há 2 dias')
    expect(montarPendencias({ ...vazio, lotes: [{ ...lote, status: 'enviado' }] }).itens).toEqual([])
  })
  it('pendência fora da tabela e demais situações de tratamento', () => {
    const t = { id: 't1', patient_id: 'p2', patient_name: 'Bia', procedure: 'Limpeza' }
    const r = montarPendencias({
      ...vazio,
      tratamentos: [
        { ...t, situacao: 'fora_tabela' },
        { ...t, id: 't2', situacao: 'sem_guia' },
        { ...t, id: 't3', situacao: 'pendente' },
      ],
    })
    expect(r.itens.map((i) => i.texto)).toEqual([
      'Limpeza de Bia: fora da tabela do convênio',
      'Limpeza de Bia: concluído sem guia',
      'Limpeza de Bia: concluído aguardando autorização',
    ])
    expect(r.itens[0].href).toBe('/pacientes/p2?aba=tratamentos')
  })
  it('operadora sem fechamento', () => {
    expect(montarPendencias({ ...vazio, operadorasSemFechamento: [{ id: 'o1', name: 'Amil' }] }).itens).toEqual([
      { tipo: 'operadora_sem_fechamento', texto: 'Amil sem dia de fechamento', href: '/configuracoes/convenios' },
    ])
  })
  it('contador soma só tratamentos e lotes; ordem dos tipos', () => {
    const r = montarPendencias({
      hoje,
      guias: [guia, { ...guia, id: 'g2', status: 'liberada', password_valid_until: '2026-03-12' }],
      tratamentos: [{ id: 't1', patient_id: 'p2', patient_name: 'Bia', procedure: 'Limpeza', situacao: 'sem_guia' }],
      lotes: [lote],
      operadorasSemFechamento: [{ id: 'o1', name: 'Amil' }],
    })
    expect(r.itens.map((i) => i.tipo)).toEqual([
      'lote_prazo', 'tratamento_sem_faturar', 'guia_aguardando', 'senha_vencendo', 'operadora_sem_fechamento',
    ])
    expect(r.contador).toBe(2)
  })
})
