import { describe, it, expect } from 'vitest'
import { montarPainel, type EntradaPainel } from '@/lib/indicadores/painel'
import type { ConsultaIn } from '@/lib/indicadores/agenda'
import type { FunnelRow } from '@/lib/orcamentos/funil'

const P1 = 'p1'
const P2 = 'p2'
const AGORA = new Date('2026-11-08T15:00:00Z')

let n = 0
const consulta = (professional_id: string, status: ConsultaIn['status'], start_time: string, patient_id = 'pacX'): ConsultaIn => ({
  id: `c${n++}`, patient_id, professional_id, start_time, status,
})
const orc = (professional_id: string | null, status: FunnelRow['status']): FunnelRow => ({
  id: `o${n++}`, status, sent_at: '2026-10-10T15:00:00Z', decided_at: null, total: 1000,
  approved_total: status === 'approved' ? 1000 : 0, professional_id, professional_name: '', lost_reason: null,
})

const entrada: EntradaPainel = {
  consultas: [
    consulta(P1, 'completed', '2026-10-05T15:00:00Z'),
    consulta(P1, 'completed', '2026-10-06T15:00:00Z'),
    consulta(P1, 'completed', '2026-10-07T15:00:00Z'),
    consulta(P1, 'no_show', '2026-10-08T15:00:00Z'),
    consulta(P2, 'completed', '2026-10-09T15:00:00Z'),
    consulta(P2, 'no_show', '2026-10-10T15:00:00Z'),
    consulta(P1, 'completed', '2026-09-05T15:00:00Z'),
    consulta(P1, 'completed', '2026-09-06T15:00:00Z'),
    consulta(P1, 'no_show', '2026-09-07T15:00:00Z'),
    consulta(P1, 'no_show', '2026-09-08T15:00:00Z'),
  ],
  recebimentos: [
    { patient_id: 'a', amount: 100, payment_method: 'pix', paid_at: '2026-10-03' },
    { patient_id: 'a', amount: 50, payment_method: 'pix', paid_at: '2026-10-20' },
    { patient_id: 'b', amount: 100, payment_method: 'pix', paid_at: '2026-09-10' },
  ],
  tratamentos: [
    { professional_id: P1, value: 200, completed_at: '2026-10-04' },
    { professional_id: null, value: 100, completed_at: '2026-10-05' },
  ],
  pacientes: [
    { id: '1', created_at: '2026-10-02T15:00:00Z', source: 'whatsapp' },
    { id: '2', created_at: '2026-10-03T15:00:00Z', source: null },
    { id: '3', created_at: '2026-09-03T15:00:00Z', source: null },
  ],
  funil: [orc(P1, 'approved'), orc(P2, 'sent')],
  profissionais: [{ id: P1, name: 'Zélia' }, { id: P2, name: 'Ana' }],
  nomesPacientes: { pacX: 'Xavier' },
}

describe('maisFaltam no painel', () => {
  it('empate cruzando a 10ª posição escolhe por nome', () => {
    // 12 pacientes com 2 faltas cada; nomes fora de ordem em relação aos ids.
    const nomes = ['Lia', 'Kátia', 'João', 'Iara', 'Hugo', 'Gil', 'Fábio', 'Eva', 'Dora', 'Caio', 'Bia', 'Ana']
    const consultas = nomes.flatMap((_, i) => [
      consulta(P1, 'no_show', '2026-10-05T15:00:00Z', `pac${i}`),
      consulta(P1, 'no_show', '2026-10-06T15:00:00Z', `pac${i}`),
    ])
    // pac11 (Ana) tem 3 faltas e fica no topo; os demais empatam em 2.
    consultas.push(consulta(P1, 'no_show', '2026-10-07T15:00:00Z', 'pac11'))
    const nomesPacientes = Object.fromEntries(nomes.map((n, i) => [`pac${i}`, n]))
    const r = montarPainel({ ...entrada, consultas, nomesPacientes }, '2026-10', AGORA, null).agenda.maisFaltam
    expect(r).toHaveLength(10)
    expect(r.map((x) => x.nome)).toEqual(['Ana', 'Bia', 'Caio', 'Dora', 'Eva', 'Fábio', 'Gil', 'Hugo', 'Iara', 'João'])
  })
})

describe('montarPainel', () => {
  const p = montarPainel(entrada, '2026-10', AGORA, null)

  it('cartões com valores e variações', () => {
    expect(p.cartoes.comparecimento.valor).toBeCloseTo(4 / 6)
    expect(p.cartoes.comparecimento.variacao).toEqual({ tipo: 'pp', valor: 16.7 })
    expect(p.cartoes.faltas).toEqual({ valor: 2, variacao: { tipo: 'pct', valor: 0 } })
    expect(p.cartoes.recebido).toEqual({ valor: 15000, variacao: { tipo: 'pct', valor: 50 } })
    expect(p.cartoes.ticket).toEqual({ valor: 15000, variacao: { tipo: 'pct', valor: 50 } })
    expect(p.cartoes.aprovacao).toEqual({ valor: 0.5, variacao: { tipo: 'novo', valor: null } })
    expect(p.cartoes.novos).toEqual({ valor: 2, variacao: { tipo: 'pct', valor: 100 } })
    expect(p.novos).toEqual({ total: 2, whatsapp: 1 })
  })

  it('mês corrente é parcial, mês passado não', () => {
    expect(p.parcial).toBe(false)
    expect(montarPainel(entrada, '2026-11', AGORA, null).parcial).toBe(true)
    expect(p.hoje).toBe('2026-11-08')
    expect(p.dentista).toBeNull()
  })

  it('tendência com 6 meses em ordem', () => {
    expect(p.tendencia.map((t) => t.mes)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
    expect(p.tendencia[5]).toMatchObject({ recebidoCentavos: 15000, ticketCentavos: 15000, novos: 2, aprovacao: 0.5 })
    expect(p.tendencia[0]).toMatchObject({ comparecimento: null, recebidoCentavos: 0, ticketCentavos: null })
  })

  it('nomes, ordenação e "Sem dentista"', () => {
    expect(p.agenda.porDentista.map((d) => d.nome)).toEqual(['Ana', 'Zélia'])
    expect(p.financeiro.producao.porDentista.map((d) => d.nome)).toEqual(['Sem dentista', 'Zélia'])
    expect(p.financeiro.producao.totalCentavos).toBe(30000)
    expect(p.agenda.maisFaltam).toEqual([{ patient_id: 'pacX', nome: 'Xavier', faltas: 4, ultima: '2026-10-10' }])
  })

  it('filtro de dentista não afeta recebido', () => {
    const f = montarPainel(entrada, '2026-10', AGORA, P1)
    expect(f.dentista).toEqual({ id: P1, name: 'Zélia' })
    expect(f.cartoes.recebido).toEqual(p.cartoes.recebido)
    expect(f.cartoes.ticket).toEqual(p.cartoes.ticket)
    expect(f.cartoes.novos).toEqual(p.cartoes.novos)
    expect(f.financeiro.recebidoCentavos).toBe(p.financeiro.recebidoCentavos)
    expect(f.tendencia.map((t) => t.recebidoCentavos)).toEqual(p.tendencia.map((t) => t.recebidoCentavos))
    // mudam: agenda, produção, orçamentos
    expect(f.agenda.total).toBe(4)
    expect(f.cartoes.comparecimento.valor).toBe(0.75)
    expect(f.financeiro.producao.totalCentavos).toBe(20000)
    expect(f.cartoes.aprovacao.valor).toBe(1)
    expect(f.orcamentos.presented.count).toBe(1)
    expect(f.agenda.maisFaltam[0].faltas).toBe(3)
  })
})

describe('montarPainel com volume', () => {
  it('10 mil consultas continuam corretas (sem asserção de tempo)', () => {
    const consultas = Array.from({ length: 10000 }, (_, i) =>
      consulta(i % 2 ? P1 : P2, i % 10 === 0 ? 'no_show' : 'completed', `2026-${String(5 + (i % 6)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}T15:00:00Z`, `pac${i % 500}`),
    )
    const painel = montarPainel({ ...entrada, consultas }, '2026-10', AGORA, null)
    expect(painel.agenda.total).toBeGreaterThan(1000)
    expect(painel.agenda.maisFaltam).toHaveLength(10)
  })
})
