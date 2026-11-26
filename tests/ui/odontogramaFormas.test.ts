import { describe, expect, it } from 'vitest'
import { coroa, ehSuperior, faixasDaCoroa, mesialADireita, raizes, tipoDoDente } from '@/components/paciente/odontogramaFormas'

describe('lado das faces', () => {
  it('mesial fica do lado do meio da boca', () => {
    // lado direito do paciente aparece à esquerda da tela: mesial à direita do dente
    for (const n of [11, 16, 18, 41, 46, 51, 55, 81, 85]) expect(mesialADireita(n)).toBe(true)
    for (const n of [21, 26, 28, 31, 36, 61, 65, 71, 75]) expect(mesialADireita(n)).toBe(false)
  })

  it('separa as arcadas superior e inferior', () => {
    for (const n of [11, 28, 55, 61]) expect(ehSuperior(n)).toBe(true)
    for (const n of [31, 48, 71, 85]) expect(ehSuperior(n)).toBe(false)
  })

  it('a faixa mesial da coroa em pé fica do lado do meio', () => {
    const c = coroa('molar', false)
    const q1 = faixasDaCoroa(c, mesialADireita(16))
    const q2 = faixasDaCoroa(c, mesialADireita(26))
    expect(q1.xMesial).toBeGreaterThan(q1.xDistal)
    expect(q2.xMesial).toBeLessThan(q2.xDistal)
  })
})

describe('forma do dente', () => {
  it('reconhece o tipo pelo número', () => {
    expect([11, 12, 13, 14, 15, 16, 17, 18].map(tipoDoDente))
      .toEqual(['central', 'lateral', 'canino', 'premolar', 'premolar', 'molar', 'molar', 'siso'])
    expect([51, 52, 53, 54, 55].map(tipoDoDente)).toEqual(['central', 'lateral', 'canino', 'molar', 'molar'])
  })

  it('molar superior tem 3 raízes e o inferior 2', () => {
    expect(raizes('molar', true, false)).toHaveLength(3)
    expect(raizes('molar', false, false)).toHaveLength(2)
    expect(raizes('canino', true, false)).toHaveLength(1)
  })

  it('decíduo tem coroa menor que o permanente', () => {
    expect(coroa('molar', true).meiaLargura).toBeLessThan(coroa('molar', false).meiaLargura)
  })
})
