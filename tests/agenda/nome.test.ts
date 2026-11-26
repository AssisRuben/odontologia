import { describe, it, expect } from 'vitest'
import { nomeExibicao } from '@/lib/agenda/nome'

describe('nomeExibicao', () => {
  it('nome todo em maiúsculas vira só com as iniciais', () => {
    expect(nomeExibicao('FRANCISCO ELENILDO COSTA CAVALCANTE')).toBe('Francisco Elenildo Costa Cavalcante')
  })

  it('de, da, do, das, dos e "e" ficam em minúsculas, menos no começo', () => {
    expect(nomeExibicao('MARIA DAS DORES DOS SANTOS E SILVA')).toBe('Maria das Dores dos Santos e Silva')
    expect(nomeExibicao('DA SILVA JOÃO')).toBe('Da Silva João')
  })

  it('acentos e nomes com hífen', () => {
    expect(nomeExibicao('ÂNGELA MARIA-CLARA ÉRICA')).toBe('Ângela Maria-Clara Érica')
  })

  it('nome todo em minúsculas também é ajustado', () => {
    expect(nomeExibicao('josé de souza')).toBe('José de Souza')
  })

  it('nome já escrito com maiúsculas e minúsculas fica como está', () => {
    expect(nomeExibicao('Ana McDonald de Souza')).toBe('Ana McDonald de Souza')
  })

  it('espaços sobrando somem', () => {
    expect(nomeExibicao('  JOÃO   PEDRO  ')).toBe('João Pedro')
  })
})
