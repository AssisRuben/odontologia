import { describe, it, expect } from 'vitest'
import { variacaoTaxa, variacaoValor, rotuloVariacao } from '@/lib/indicadores/variacao'

describe('variacao', () => {
  it('taxa em pontos percentuais', () => {
    const v = variacaoTaxa(0.9, 0.85)
    expect(v).toEqual({ tipo: 'pp', valor: 5 })
    expect(rotuloVariacao(v)).toBe('▲ 5 p.p.')
  })
  it('pp com casa decimal usa vírgula', () => {
    expect(rotuloVariacao(variacaoTaxa(0.875, 0.85))).toBe('▲ 2,5 p.p.')
    expect(rotuloVariacao(variacaoTaxa(0.8, 0.85))).toBe('▼ 5 p.p.')
  })
  it('empate de taxa', () => {
    expect(rotuloVariacao(variacaoTaxa(0.5, 0.5))).toBe('0 p.p.')
  })
  it('taxa sem anterior é novo; sem nada é vazio', () => {
    expect(variacaoTaxa(0.5, null)).toEqual({ tipo: 'novo', valor: null })
    expect(rotuloVariacao(variacaoTaxa(0.5, null))).toBe('novo')
    expect(variacaoTaxa(null, null)).toEqual({ tipo: 'vazio', valor: null })
    expect(rotuloVariacao(variacaoTaxa(null, null))).toBe('—')
    expect(variacaoTaxa(null, 0.5)).toEqual({ tipo: 'vazio', valor: null })
  })
  it('valor em %', () => {
    expect(rotuloVariacao(variacaoValor(88, 100))).toBe('▼ 12%')
    expect(rotuloVariacao(variacaoValor(112, 100))).toBe('▲ 12%')
    expect(rotuloVariacao(variacaoValor(100, 100))).toBe('0%')
    expect(variacaoValor(5, 0).tipo).toBe('novo')
    expect(rotuloVariacao(variacaoValor(5, 0))).toBe('novo')
    expect(variacaoValor(0, 0).tipo).toBe('vazio')
    expect(rotuloVariacao(variacaoValor(0, 0))).toBe('—')
  })
})
