import { describe, it, expect } from 'vitest'
import { CATEGORIES, toCategory, categoryLabel, defaultGroup, groupLabel } from '@/lib/livro-caixa/categorias'

describe('categorias', () => {
  it('every category has label and group as in spec', () => {
    expect(CATEGORIES).toHaveLength(16)
    for (const c of CATEGORIES) expect(c.label.length).toBeGreaterThan(0)
    expect(defaultGroup('salarios')).toBe('pessoal')
    expect(defaultGroup('emolumentos')).toBe('emolumentos')
    expect(defaultGroup('equipamentos')).toBeNull()
    expect(defaultGroup('tarifas')).toBe('custeio')
  })

  it('toCategory falls back to outras', () => {
    expect(toCategory('Material')).toBe('outras')
    expect(toCategory(null)).toBe('outras')
    expect(toCategory(undefined)).toBe('outras')
    expect(toCategory('material')).toBe('material')
  })

  it('categoryLabel resolves labels with fallback', () => {
    expect(categoryLabel('material')).toBe('Material odontológico')
    expect(categoryLabel('xyz')).toBe('Outras')
  })

  it('groupLabel', () => {
    expect(groupLabel(null)).toBe('Não dedutível')
    expect(groupLabel('custeio')).toBe('Despesas de custeio')
    expect(groupLabel('pessoal')).toBe('Salários e encargos')
    expect(groupLabel('emolumentos')).toBe('Emolumentos')
  })
})
