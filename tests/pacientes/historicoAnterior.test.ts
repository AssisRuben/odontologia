import { describe, it, expect } from 'vitest'
import { resumoHistorico, somarPorOrcamento, type LegacyPayment } from '@/lib/pacientes/historicoAnterior'

const linha = (id: string, amount: number, original_status: 'paid' | 'open', budget_id: string | null = null): LegacyPayment => ({
  id,
  clinic_id: 'clinica-teste',
  patient_id: 'paciente-teste',
  budget_id,
  source_id: `origem-${id}`,
  description: null,
  amount,
  due_date: null,
  paid_at: null,
  payment_method: null,
  installment_number: null,
  installment_count: null,
  original_status,
  created_at: '2026-01-01T00:00:00Z',
})

describe('resumoHistorico', () => {
  it('separa pagos e em aberto', () => {
    expect(resumoHistorico([linha('a', 100, 'paid'), linha('b', 50, 'open'), linha('c', 25, 'paid')]))
      .toEqual({ pago: 125, emAberto: 50 })
  })

  it('soma sem erro de centavos', () => {
    expect(resumoHistorico([linha('a', 0.1, 'paid'), linha('b', 0.2, 'paid')]).pago).toBe(0.3)
    expect(resumoHistorico([linha('a', 0.1, 'open'), linha('b', 0.2, 'open')]).emAberto).toBe(0.3)
  })

  it('aceita valor numérico vindo como texto do banco', () => {
    const texto = { ...linha('a', 0, 'paid'), amount: '10.25' as unknown as number }
    expect(resumoHistorico([texto, linha('b', 0.05, 'paid')]).pago).toBe(10.3)
  })

  it('lista vazia fica zerada', () => {
    expect(resumoHistorico([])).toEqual({ pago: 0, emAberto: 0 })
  })
})

describe('somarPorOrcamento', () => {
  const orcamento = [linha('a', 400, 'paid', 'o1'), linha('b', 600, 'open', 'o1')]

  it('por padrão soma só o que foi pago', () => {
    expect(somarPorOrcamento(orcamento)).toEqual({ o1: 400 })
  })

  it('separa pago e em aberto do mesmo orçamento', () => {
    expect(somarPorOrcamento(orcamento, 'paid')).toEqual({ o1: 400 })
    expect(somarPorOrcamento(orcamento, 'open')).toEqual({ o1: 600 })
  })

  it('orçamento sem linhas na situação pedida fica de fora', () => {
    expect(somarPorOrcamento([linha('a', 10, 'open', 'o1')], 'paid')).toEqual({})
    expect(somarPorOrcamento([linha('a', 10, 'paid', 'o1')], 'open')).toEqual({})
  })

  it('soma sem erro de centavos nas duas situações', () => {
    expect(somarPorOrcamento([linha('a', 0.1, 'paid', 'o1'), linha('b', 0.2, 'paid', 'o1')]).o1).toBe(0.3)
    expect(somarPorOrcamento([linha('a', 0.1, 'open', 'o1'), linha('b', 0.2, 'open', 'o1')], 'open').o1).toBe(0.3)
  })

  it('ignora linha sem orçamento', () => {
    expect(somarPorOrcamento([linha('a', 10, 'paid', null), linha('b', 5, 'paid', 'o1')])).toEqual({ o1: 5 })
    expect(somarPorOrcamento([linha('a', 10, 'open', null), linha('b', 5, 'open', 'o1')], 'open')).toEqual({ o1: 5 })
  })

  it('lista vazia fica sem orçamentos', () => {
    expect(somarPorOrcamento([])).toEqual({})
    expect(somarPorOrcamento([], 'open')).toEqual({})
  })
})
