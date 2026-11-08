import { describe, it, expect } from 'vitest'
import { montarPendencias } from '@/lib/convenios/pendencias'

const hoje = '2026-03-10'
const vazio = { hoje, guias: [], tratamentos: [], lotes: [], operadorasSemFechamento: [], lotesEnviados: [], glosas: [] }
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
  it('um dia no singular', () => {
    expect(montarPendencias({ ...vazio, lotes: [{ ...lote, due_date: '2026-03-09' }] }).itens[0].texto)
      .toBe('Lote Uniodonto 03/2026: prazo vencido há 1 dia')
    expect(montarPendencias({ ...vazio, lotes: [{ ...lote, due_date: '2026-03-11' }] }).itens[0].texto)
      .toBe('Lote Uniodonto 03/2026: prazo em 1 dia')
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
      lotesEnviados: [],
      glosas: [],
    })
    expect(r.itens.map((i) => i.tipo)).toEqual([
      'lote_prazo', 'tratamento_sem_faturar', 'guia_aguardando', 'senha_vencendo', 'operadora_sem_fechamento',
    ])
    expect(r.contador).toBe(2)
  })

  describe('pagamento e recurso', () => {
    const enviado = { id: 'l2', plan_name: 'Uniodonto', period_end: '2026-02-28', sent_at: '2026-02-08', payment_days: 30 }
    const glosa = {
      item_id: 'i1', patient_name: 'Ana', glosa_code: '1801', paid_at: '2026-03-01', appeal_days: 14,
      appeal_status: 'nenhum' as const, appeal_result_at: null as string | null, recovered_payment_id: null as string | null,
    }
    const href = '/convenios?aba=pagamentos'
    it('pagamento atrasado: 1 dia entra, no dia previsto não', () => {
      // previsto 2026-03-10 = hoje
      expect(montarPendencias({ ...vazio, lotesEnviados: [enviado] }).itens).toEqual([])
      expect(montarPendencias({ ...vazio, lotesEnviados: [{ ...enviado, sent_at: '2026-02-07' }] }).itens).toEqual([
        { tipo: 'pagamento_atrasado', texto: 'Lote Uniodonto 02/2026: pagamento atrasado há 1 dia', href },
      ])
      expect(montarPendencias({ ...vazio, lotesEnviados: [{ ...enviado, sent_at: '2026-02-01' }] }).itens[0].texto)
        .toBe('Lote Uniodonto 02/2026: pagamento atrasado há 7 dias')
    })
    it('prazo de recurso: 5 dias entra, 6 não, hoje e vencido', () => {
      const g = (paid_at: string) => montarPendencias({ ...vazio, glosas: [{ ...glosa, paid_at }] }).itens
      // prazo = paid_at + 14; hoje = 03-10
      expect(g('2026-03-01')).toEqual([
        { tipo: 'recurso_prazo', texto: 'Glosa de Ana (1801): prazo de recurso em 5 dias', href },
      ])
      expect(g('2026-02-28')[0].texto).toBe('Glosa de Ana (1801): prazo de recurso em 4 dias')
      expect(g('2026-03-02')).toEqual([])
      expect(g('2026-02-24')[0].texto).toBe('Glosa de Ana (1801): prazo de recurso hoje')
      expect(g('2026-02-23')[0].texto).toBe('Glosa de Ana (1801): prazo de recurso vencido há 1 dia')
      expect(g('2026-02-10')[0].texto).toBe('Glosa de Ana (1801): prazo de recurso vencido há 14 dias')
    })
    it('glosa em recurso ou negada não entra', () => {
      for (const appeal_status of ['em_recurso', 'negado'] as const) {
        expect(montarPendencias({ ...vazio, glosas: [{ ...glosa, appeal_status, paid_at: '2026-02-01' }] }).itens).toEqual([])
      }
    })
    it('recurso aceito sem recebimento: 31 dias entra, 30 não, recebido não', () => {
      const a = { ...glosa, appeal_status: 'aceito' as const }
      const r = (appeal_result_at: string, recovered_payment_id: string | null = null) =>
        montarPendencias({ ...vazio, glosas: [{ ...a, appeal_result_at, recovered_payment_id }] }).itens
      expect(r('2026-02-07')).toEqual([
        { tipo: 'recurso_sem_recebimento', texto: 'Recurso aceito de Ana sem recebimento há 31 dias', href },
      ])
      expect(r('2026-02-08')).toEqual([])
      expect(r('2026-02-07', 'pay1')).toEqual([])
    })
    it('contador inclui atrasado e prazo de recurso, não o aceito sem recebimento; ordem', () => {
      const r = montarPendencias({
        ...vazio,
        lotes: [lote],
        operadorasSemFechamento: [{ id: 'o1', name: 'Amil' }],
        lotesEnviados: [{ ...enviado, sent_at: '2026-02-01' }],
        glosas: [{ ...glosa, item_id: 'i2', appeal_status: 'aceito', appeal_result_at: '2026-01-01' }, glosa],
      })
      expect(r.itens.map((i) => i.tipo)).toEqual([
        'pagamento_atrasado', 'recurso_prazo', 'lote_prazo', 'operadora_sem_fechamento', 'recurso_sem_recebimento',
      ])
      expect(r.contador).toBe(3)
    })
  })
})
