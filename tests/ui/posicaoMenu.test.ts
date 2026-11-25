import { describe, expect, it } from 'vitest'
import { posicaoMenu } from '@/lib/ui/posicaoMenu'

// Janela 1366 x 768; menu de 120px de altura ancorado num botão de 28px.
const janela = { largura: 1366, altura: 768 }
const botao = (top: number) => ({ top, bottom: top + 28, right: 1300 })

describe('posicaoMenu', () => {
  it('abre logo abaixo do botão quando cabe', () => {
    expect(posicaoMenu(botao(200), 120, janela)).toEqual({ top: 232, right: 66 })
  })

  it('abre acima do botão quando não cabe embaixo (último registro da página)', () => {
    // botão em 680..708: embaixo iria até 832, passa da janela
    expect(posicaoMenu(botao(680), 120, janela)).toEqual({ top: 556, right: 66 })
  })

  it('sem espaço nem embaixo nem em cima, encosta no limite de baixo da janela', () => {
    const baixa = { largura: 1366, altura: 200 }
    // embaixo: 132+120 > 192; em cima: 100-4-120 < 8 → fica em 200-8-120 = 72
    expect(posicaoMenu(botao(100), 120, baixa)).toEqual({ top: 72, right: 66 })
  })

  it('menu maior que a janela começa na margem de cima', () => {
    expect(posicaoMenu(botao(100), 400, { largura: 1366, altura: 300 }).top).toBe(8)
  })
})
