import { describe, it, expect } from 'vitest'
import {
  glosaDe, totaisLote, agruparPorPaciente, dataPrevista, prazoRecurso,
} from '@/lib/convenios/pagamentos/calculo'

describe('glosaDe', () => {
  it('diferença em centavos, nunca negativa', () => {
    expect(glosaDe(100, 60.1)).toBe(39.9)
    expect(glosaDe(0.3, 0.1)).toBe(0.2)
    expect(glosaDe(50, 50)).toBe(0)
    expect(glosaDe(50, 60)).toBe(0)
  })
})

describe('totaisLote', () => {
  it('soma sem erro de ponto flutuante', () => {
    const t = totaisLote([{ value: 0.1, paid_value: 0.1 }, { value: 0.2, paid_value: 0.2 }], 0.3)
    expect(t).toEqual({ enviado: 0.3, pago: 0.3, glosado: 0, diferenca: 0 })
  })
  it('glosa e diferença do depósito', () => {
    const t = totaisLote([{ value: 100, paid_value: 80 }, { value: 50, paid_value: 50 }], 125)
    expect(t).toEqual({ enviado: 150, pago: 130, glosado: 20, diferenca: -5 })
  })
  it('sem depósito a diferença é nula; item sem pagamento não conta como pago', () => {
    const t = totaisLote([{ value: 100, paid_value: null }], null)
    expect(t).toEqual({ enviado: 100, pago: 0, glosado: 0, diferenca: null })
  })
})

describe('agruparPorPaciente', () => {
  it('soma por paciente', () => {
    expect(agruparPorPaciente([
      { patient_id: 'p1', paid_value: 10.1 }, { patient_id: 'p2', paid_value: 5 }, { patient_id: 'p1', paid_value: 20.2 },
    ])).toEqual([{ patient_id: 'p1', total: 30.3 }, { patient_id: 'p2', total: 5 }])
  })
  it('agruparPorPaciente ignora soma zero', () => {
    expect(agruparPorPaciente([
      { patient_id: 'p1', paid_value: 0 }, { patient_id: 'p2', paid_value: 7 }, { patient_id: 'p1', paid_value: 0 },
    ])).toEqual([{ patient_id: 'p2', total: 7 }])
  })
})

describe('datas', () => {
  it('dataPrevista', () => {
    expect(dataPrevista('2026-11-07', 30)).toBe('2026-12-07')
    expect(dataPrevista('2026-11-07', 0)).toBe('2026-11-07')
  })
  it('prazoRecurso', () => {
    expect(prazoRecurso('2026-11-07', 30)).toBe('2026-12-07')
    expect(prazoRecurso('2026-12-20', 15)).toBe('2027-01-04')
  })
})
