/** Distância mínima entre o menu e a borda da janela. */
const MARGEM = 8
/** Espaço entre o botão e o menu. */
const AFASTAMENTO = 4

type Ancora = { top: number; bottom: number; right: number }

/**
 * Onde abrir um menu flutuante (position: fixed) preso a um botão: embaixo do botão quando cabe,
 * em cima quando não cabe (ex.: último registro da página) e, sem espaço em nenhum dos dois, o mais
 * baixo possível sem sair da janela. Alinha a borda direita do menu com a do botão.
 */
export function posicaoMenu(ancora: Ancora, alturaMenu: number, janela: { largura: number; altura: number }) {
  const right = janela.largura - ancora.right
  const embaixo = ancora.bottom + AFASTAMENTO
  if (embaixo + alturaMenu <= janela.altura - MARGEM) return { top: embaixo, right }

  const emCima = ancora.top - AFASTAMENTO - alturaMenu
  if (emCima >= MARGEM) return { top: emCima, right }

  return { top: Math.max(MARGEM, janela.altura - MARGEM - alturaMenu), right }
}
