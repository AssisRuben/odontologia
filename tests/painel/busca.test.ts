import { describe, expect, it } from 'vitest'
import { filtroBuscaPaciente } from '@/lib/busca/pacientes'

describe('filtroBuscaPaciente', () => {
  it('busca por nome, telefone e CPF', () => {
    expect(filtroBuscaPaciente('Ana')).toBe('name.ilike.%Ana%,phone.ilike.%Ana%,whatsapp.ilike.%Ana%,cpf.ilike.%Ana%')
  })

  it('tira caracteres que quebram o filtro', () => {
    expect(filtroBuscaPaciente('  a,(b)%*  ')).toBe('name.ilike.%ab%,phone.ilike.%ab%,whatsapp.ilike.%ab%,cpf.ilike.%ab%')
  })

  it('com só dígitos, também procura sem a máscara do telefone/CPF', () => {
    expect(filtroBuscaPaciente('11 9999')).toContain('phone.ilike.%119999%')
  })

  it('devolve null para termo curto demais', () => {
    expect(filtroBuscaPaciente(' a ')).toBeNull()
    expect(filtroBuscaPaciente('(,)')).toBeNull()
  })
})
