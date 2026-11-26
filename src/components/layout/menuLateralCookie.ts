// Fora do arquivo 'use client': o layout (servidor) precisa do valor real, não de uma referência de cliente.

/** Cookie com a preferência do menu lateral (lido no servidor para a página já abrir no tamanho certo). */
export const COOKIE_MENU = 'menu'

/** Começa recolhido; só abre se a pessoa escolheu deixar aberto. */
export const estaRecolhido = (valor: string | undefined) => valor !== 'aberto'
