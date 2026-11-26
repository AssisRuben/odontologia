import { describe, expect, it } from 'vitest'
import { posicaoMenu, topoDentroDaJanela } from '@/lib/ui/posicaoMenu'

describe('topoDentroDaJanela', () => {
  it('mantém o topo desejado quando cabe', () => {
    expect(topoDentroDaJanela(200, 300, 768)).toBe(200)
  })

  it('sobe o suficiente para o fim caber na janela (consulta no fim da agenda)', () => {
    // popup de 420px pedido em 500 iria até 920; sobe para 768-8-420 = 340
    expect(topoDentroDaJanela(500, 420, 768)).toBe(340)
  })

  it('maior que a janela: começa na margem de cima', () => {
    expect(topoDentroDaJanela(300, 900, 768)).toBe(8)
  })
})

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
