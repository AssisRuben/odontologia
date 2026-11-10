import { describe, it, expect } from 'vitest'
import { agruparReceber, tipoDe, type Lembrete, type TipoReceber } from '@/lib/receber/agrupar'
import type { Payment } from '@/types'

const HOJE = '2026-11-10'

let seq = 0
function pg(o: Partial<Payment> & { nome?: string } = {}): Payment {
  const { nome, ...resto } = o
  seq += 1
  return {
    id: `p${seq}`,
    clinic_id: 'c1',
    patient_id: 'pa1',
    amount: 100,
    status: 'pending',
    due_date: HOJE,
    payment_method: 'pix',
    charge_kind: 'avulsa',
    created_at: '2026-11-01T00:00:00Z',
    patient: { name: nome ?? 'Maria' } as Payment['patient'],
    ...resto,
  } as Payment
}

function rodar(
  pagamentos: Payment[],
  extra: { lembretes?: Lembrete[]; busca?: string; tipo?: TipoReceber } = {},
) {
  return agruparReceber({
    hoje: HOJE,
    pagamentos,
    lembretes: extra.lembretes ?? [],
    filtro: { busca: extra.busca ?? '', tipo: extra.tipo ?? 'todos' },
  })
}

describe('agruparReceber - grupos', () => {
  it('vencido ontem entra em atraso com 1 dia', () => {
    const r = rodar([pg({ due_date: '2026-11-09' })])
    expect(r.grupos.atraso).toHaveLength(1)
    expect(r.grupos.atraso[0].diasAtraso).toBe(1)
  })

  it('vencimento hoje entra em proximos', () => {
    const r = rodar([pg({ due_date: '2026-11-10' })])
    expect(r.grupos.proximos).toHaveLength(1)
    expect(r.grupos.atraso).toHaveLength(0)
  })

  it('limite de 7 dias', () => {
    const r = rodar([pg({ due_date: '2026-11-17' }), pg({ due_date: '2026-11-18' })])
    expect(r.grupos.proximos.map((i) => i.pagamento.due_date)).toEqual(['2026-11-17'])
    expect(r.grupos.depois.map((i) => i.pagamento.due_date)).toEqual(['2026-11-18'])
  })

  it('sem vencimento vai para o fim de depois', () => {
    const r = rodar([
      pg({ due_date: undefined, id: 'sem' }),
      pg({ due_date: '2026-12-30' }),
      pg({ due_date: '2026-11-20' }),
    ])
    const ids = r.grupos.depois.map((i) => i.pagamento.due_date ?? null)
    expect(ids).toEqual(['2026-11-20', '2026-12-30', null])
    expect(r.grupos.depois[2].diasAtraso).toBeNull()
  })

  it('ordenacao', () => {
    const r = rodar([
      pg({ due_date: '2026-11-08' }),
      pg({ due_date: '2026-10-01' }),
      pg({ due_date: '2026-11-09' }),
      pg({ due_date: '2026-11-15' }),
      pg({ due_date: '2026-11-11' }),
    ])
    expect(r.grupos.atraso.map((i) => i.pagamento.due_date)).toEqual([
      '2026-10-01',
      '2026-11-08',
      '2026-11-09',
    ])
    expect(r.grupos.proximos.map((i) => i.pagamento.due_date)).toEqual(['2026-11-11', '2026-11-15'])
  })
})

describe('tipoDe', () => {
  it('classifica', () => {
    expect(tipoDe(pg({ charge_kind: 'carne' }))).toBe('boleto')
    expect(tipoDe(pg({ charge_kind: 'avulsa', payment_method: 'boleto' }))).toBe('boleto')
    expect(tipoDe(pg({ charge_kind: 'avulsa', payment_method: 'pix' }))).toBe('link')
    expect(tipoDe(pg({ charge_kind: 'cartao_parcelado' }))).toBe('cartao')
    expect(tipoDe(pg({ charge_kind: 'manual' }))).toBe('manual')
  })
})

describe('filtros', () => {
  it('tipo cartao filtra e muda os totais', () => {
    const r = rodar(
      [
        pg({ charge_kind: 'cartao_parcelado', amount: 50 }),
        pg({ charge_kind: 'manual', amount: 70 }),
      ],
      { tipo: 'cartao' },
    )
    expect(r.grupos.proximos).toHaveLength(1)
    expect(r.totais.total).toEqual({ totalCentavos: 5000, quantidade: 1 })
  })

  it('busca sem acento e sem caixa; vazia mostra tudo', () => {
    const ps = [pg({ nome: 'João Silva' }), pg({ nome: 'Ana' })]
    expect(rodar(ps, { busca: 'joao' }).totais.total.quantidade).toBe(1)
    expect(rodar(ps, { busca: '  ' }).totais.total.quantidade).toBe(2)
  })
})

describe('totais', () => {
  it('soma em centavos por grupo', () => {
    const r = rodar([
      pg({ due_date: '2026-11-01', amount: 123.45 }),
      pg({ due_date: '2026-11-12', amount: 10 }),
      pg({ due_date: '2026-12-12', amount: 5.5 }),
    ])
    expect(r.totais.atraso).toEqual({ totalCentavos: 12345, quantidade: 1 })
    expect(r.totais.proximos).toEqual({ totalCentavos: 1000, quantidade: 1 })
    expect(r.totais.total).toEqual({ totalCentavos: 13895, quantidade: 3 })
  })
})

describe('ultimo lembrete', () => {
  it('pega o mais recente e mapeia o tipo', () => {
    const p = pg()
    const r = rodar([p], {
      lembretes: [
        { payment_id: p.id, type: 'charge', sent_at: '2026-11-05T12:00:00Z' },
        { payment_id: p.id, type: 'manual', sent_at: '2026-11-08T12:00:00Z' },
        { payment_id: 'outro', type: 'charge', sent_at: '2026-11-09T12:00:00Z' },
      ],
    })
    expect(r.grupos.proximos[0].ultimoLembrete).toEqual({ data: '2026-11-08', tipo: 'manual' })
  })

  it('charge e automatico; data em Sao Paulo', () => {
    const p = pg()
    const r = rodar([p], {
      lembretes: [{ payment_id: p.id, type: 'charge', sent_at: '2026-11-10T02:30:00Z' }],
    })
    expect(r.grupos.proximos[0].ultimoLembrete).toEqual({ data: '2026-11-09', tipo: 'automatico' })
  })

  it('sem lembrete e null', () => {
    expect(rodar([pg()]).grupos.proximos[0].ultimoLembrete).toBeNull()
  })
})

describe('vazio', () => {
  it('true quando nada sobra', () => {
    expect(rodar([]).vazio).toBe(true)
    expect(rodar([pg({ nome: 'Ana' })], { busca: 'zzz' }).vazio).toBe(true)
    expect(rodar([pg()]).vazio).toBe(false)
  })
})
