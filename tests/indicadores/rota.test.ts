import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeAdmin, type Query } from '../fakeSupabase'

const CLINIC = '00000000-0000-4000-8000-0000000000c1'
const PROF = '11111111-1111-4111-8111-111111111111'
const PAC = '22222222-2222-4222-8222-222222222222'

let resolver: (q: Query, i: number) => unknown = () => ({ data: null, error: null })
let queriesVistas: Query[] = []

vi.mock('@/lib/auth/currentClinic', () => ({
  getCurrentClinic: async () => ({ clinicId: CLINIC, userId: 'u1' }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () =>
    fakeAdmin((q, i) => {
      queriesVistas.push(q)
      return resolver(q, i)
    }).admin,
}))

import { GET } from '@/app/api/indicadores/route'

const ok = (data: unknown) => ({ data, error: null })
const get = (qs = '') => new Request(`http://x/api/indicadores${qs}`) as never
const range = (q: Query) => q.calls.find((c) => c[0] === 'range') as [string, number, number]

function cenario(profissionais = [{ id: PROF, name: 'Ana' }]) {
  resolver = (q) => {
    switch (q.table) {
      case 'appointments':
        return ok([
          { id: 'a1', patient_id: PAC, professional_id: PROF, start_time: '2026-10-05T15:00:00Z', status: 'completed' },
          { id: 'a2', patient_id: PAC, professional_id: PROF, start_time: '2026-10-06T15:00:00Z', status: 'no_show' },
        ])
      case 'payments':
        return ok([{ patient_id: PAC, amount: 200, payment_method: 'pix', paid_at: '2026-10-05T12:00:00Z' }])
      case 'professionals':
        return ok(profissionais)
      case 'patients':
        return ok(q.calls.some((c) => c[0] === 'in') ? [{ id: PAC, name: 'Bia' }] : [])
      default:
        return ok([])
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-08T15:00:00Z'))
  queriesVistas = []
  cenario()
})
afterEach(() => vi.useRealTimers())

describe('GET /api/indicadores', () => {
  it.each([[''], ['?mes=2026-13']])('mês inválido %s → 422', async (qs) => {
    const r = await GET(get(qs))
    expect(r.status).toBe(422)
    expect(await r.json()).toEqual({ error: 'Mês inválido' })
  })

  it('dentista não UUID → 422', async () => {
    const r = await GET(get('?mes=2026-10&dentista=x'))
    expect(r.status).toBe(422)
    expect(await r.json()).toEqual({ error: 'Identificador inválido' })
  })

  it('dentista de outra clínica → 404', async () => {
    cenario([])
    const r = await GET(get(`?mes=2026-10&dentista=${PROF}`))
    expect(r.status).toBe(404)
    expect(await r.json()).toEqual({ error: 'Profissional não encontrado' })
  })

  it('dentista inexistente falha antes da leitura completa', async () => {
    cenario([])
    await GET(get(`?mes=2026-10&dentista=${PROF}`))
    expect(queriesVistas).toHaveLength(1)
    expect(queriesVistas[0].table).toBe('professionals')
    expect(queriesVistas[0].calls).toContainEqual(['eq', 'id', PROF])
  })

  it('busca nomes só de quem entra no ranking', async () => {
    const base = resolver
    const linha = (id: string, pac: string, dia: string) => ({
      id, patient_id: pac, professional_id: PROF, start_time: `2026-10-${dia}T15:00:00Z`, status: 'no_show',
    })
    resolver = (q, i) => {
      if (q.table === 'appointments') {
        return ok([linha('a1', PAC, '05'), linha('a2', PAC, '06'), linha('a3', 'solo', '07')])
      }
      return base(q, i)
    }
    await GET(get('?mes=2026-10'))
    const porNome = queriesVistas.filter((q) => q.table === 'patients' && q.calls.some((c) => c[0] === 'in'))
    expect(porNome).toHaveLength(1)
    expect(porNome[0].calls).toContainEqual(['in', 'id', [PAC]])
  })

  it('200 com o painel e todas as leituras filtradas por clínica', async () => {
    const r = await GET(get('?mes=2026-10'))
    expect(r.status).toBe(200)
    const b = await r.json()
    expect(b).toMatchObject({ mes: '2026-10', hoje: '2026-11-08', parcial: false, dentista: null })
    expect(b.cartoes.recebido.valor).toBe(20000)
    expect(b.cartoes.comparecimento.valor).toBe(0.5)
    expect(b.agenda.porDentista[0]).toMatchObject({ nome: 'Ana', faltas: 1 })
    expect(b.agenda.maisFaltam).toEqual([])
    expect(b.tendencia).toHaveLength(6)
    const tabelas = new Set(queriesVistas.map((q) => q.table))
    for (const t of ['appointments', 'payments', 'treatments', 'patients', 'budgets', 'professionals']) {
      expect(tabelas.has(t)).toBe(true)
    }
    for (const q of queriesVistas) {
      expect(q.calls.some((c) => c[0] === 'eq' && c[1] === 'clinic_id' && c[2] === CLINIC)).toBe(true)
    }
  })

  it('limites da janela de 6 meses', async () => {
    await GET(get('?mes=2026-10'))
    const consultas = queriesVistas.find((q) => q.table === 'appointments')!
    expect(consultas.calls).toContainEqual(['gte', 'start_time', '2026-05-01T00:00:00-03:00'])
    expect(consultas.calls).toContainEqual(['lt', 'start_time', '2026-11-01T00:00:00-03:00'])
    const pag = queriesVistas.find((q) => q.table === 'payments')!
    expect(pag.calls).toContainEqual(['gte', 'paid_at', '2026-05-01T00:00:00Z'])
    expect(pag.calls).toContainEqual(['lt', 'paid_at', '2026-11-01T00:00:00Z'])
    expect(pag.calls).toContainEqual(['eq', 'status', 'paid'])
  })

  it('pagina consultas (1000 + 1)', async () => {
    const linha = (i: number) => ({
      id: `a${i}`, patient_id: PAC, professional_id: PROF, start_time: '2026-10-05T15:00:00Z', status: 'completed',
    })
    const base = resolver
    resolver = (q, i) => {
      if (q.table !== 'appointments') return base(q, i)
      const [, de, ate] = range(q)
      const total = 1001
      return ok(Array.from({ length: Math.max(0, Math.min(ate + 1, total) - de) }, (_, k) => linha(de + k)))
    }
    const b = await (await GET(get('?mes=2026-10'))).json()
    expect(b.agenda.total).toBe(1001)
    expect(queriesVistas.filter((q) => q.table === 'appointments')).toHaveLength(2)
  })
})
