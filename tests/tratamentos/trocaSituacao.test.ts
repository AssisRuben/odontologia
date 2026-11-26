import { describe, it, expect } from 'vitest'
import { camposDaTroca, dataExecucaoValida, passoDaTroca } from '@/lib/tratamentos/trocaSituacao'

describe('passoDaTroca', () => {
  it('mesma situação: nada a fazer', () => {
    expect(passoDaTroca('planned', 'planned', null)).toBe('nada')
  })
  it('concluir pede a data de execução', () => {
    expect(passoDaTroca('in_progress', 'completed', null)).toBe('pedirData')
  })
  it('reabrir concluído com material baixado pergunta pelo material', () => {
    expect(passoDaTroca('completed', 'in_progress', 'baixado')).toBe('perguntarMaterial')
    expect(passoDaTroca('completed', 'cancelled', 'baixado')).toBe('perguntarMaterial')
  })
  it('as outras trocas gravam na hora', () => {
    expect(passoDaTroca('planned', 'in_progress', null)).toBe('gravar')
    expect(passoDaTroca('completed', 'planned', 'pendente')).toBe('gravar')
    expect(passoDaTroca('in_progress', 'cancelled', null)).toBe('gravar')
  })
})

describe('camposDaTroca', () => {
  it('concluído grava a data de execução; as outras situações a apagam', () => {
    expect(camposDaTroca('completed', '2026-11-20')).toEqual({ status: 'completed', completed_at: '2026-11-20' })
    expect(camposDaTroca('in_progress')).toEqual({ status: 'in_progress', completed_at: null })
  })
})

describe('dataExecucaoValida', () => {
  it('não aceita data no futuro, inválida ou antes de 2000', () => {
    expect(dataExecucaoValida('2026-11-26', '2026-11-26')).toBe(true)
    expect(dataExecucaoValida('2026-11-27', '2026-11-26')).toBe(false)
    expect(dataExecucaoValida('1999-12-31', '2026-11-26')).toBe(false)
    expect(dataExecucaoValida('2026-02-30', '2026-11-26')).toBe(false)
    expect(dataExecucaoValida('', '2026-11-26')).toBe(false)
  })
})
