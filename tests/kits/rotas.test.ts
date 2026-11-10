import { describe, it, expect } from 'vitest'
import { ERROS_KITS, separarItem, erroComItem } from '@/lib/kits/rotas'

const UUID = '11111111-1111-4111-8111-111111111111'

describe('rotas de kits', () => {
  it('separarItem', () => {
    expect(separarItem('ESTOQUE_INSUFICIENTE:' + UUID)).toEqual({ codigo: 'ESTOQUE_INSUFICIENTE', itemId: UUID })
    expect(separarItem('KIT_VAZIO')).toBeNull()
    expect(separarItem(undefined)).toBeNull()
  })
  it('erroComItem', () => {
    expect(erroComItem('ESTOQUE_INSUFICIENTE', 'Luva')).toEqual({ status: 409, error: 'Saldo insuficiente de Luva' })
    expect(erroComItem('PRODUTO_INATIVO', 'Luva')).toEqual({ status: 409, error: 'Luva está inativo' })
    expect(erroComItem('ESTOQUE_INSUFICIENTE', null)).toEqual({ status: 409, error: 'Saldo insuficiente de um produto' })
    expect(erroComItem('PRODUTO_NAO_ENCONTRADO', null)).toEqual({ status: 422, error: 'Produto não encontrado' })
    expect(erroComItem('OUTRO', 'x')).toBeNull()
  })
  it('ERROS_KITS', () => {
    expect(ERROS_KITS['23505']).toEqual({ status: 409, error: 'Já existe um kit com esse nome' })
  })
})
