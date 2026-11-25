// Fora do arquivo 'use client': o layout (servidor) precisa do valor real, não de uma referência de cliente.

/** Cookie com a preferência do menu lateral (lido no servidor para a página já abrir no tamanho certo). */
export const COOKIE_MENU = 'menu'
/** Cookie com a preferência do painel do dia, à direita da agenda (computador). */
export const COOKIE_PAINEL_AGENDA = 'painel-agenda'

/** Os dois começam recolhidos; só abrem se a pessoa escolheu deixar aberto. */
export const estaRecolhido = (valor: string | undefined) => valor !== 'aberto'
