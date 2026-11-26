'use client'

import { useLayoutEffect, useRef } from 'react'
import { posicaoMenu } from './posicaoMenu'

/**
 * Posiciona um menu `fixed` junto ao botão que o abriu, virando para cima quando não cabe embaixo.
 * O menu deve nascer com a classe `invisible`: ele é medido e só aparece já no lugar certo.
 *
 * @param ancora retângulo do botão (getBoundingClientRect) ou null com o menu fechado
 */
export function useMenuAncorado<T extends HTMLElement>(ancora: DOMRect | null) {
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    const menu = ref.current
    if (!ancora || !menu) return
    const { top, right } = posicaoMenu(ancora, menu.offsetHeight, { largura: window.innerWidth, altura: window.innerHeight })
    menu.style.top = `${top}px`
    menu.style.right = `${right}px`
    menu.style.visibility = 'visible'
  }, [ancora])
  return ref
}
