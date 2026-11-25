'use client'

import { createContext, useCallback, useContext, useState } from 'react'
import { COOKIE_MENU } from './menuLateralCookie'

type MenuLateral = { recolhido: boolean; alternar: () => void }

const Contexto = createContext<MenuLateral>({ recolhido: false, alternar: () => {} })

export function useMenuLateral() {
  return useContext(Contexto)
}

/**
 * Envolve a área logada. Guarda se o menu lateral (computador) está recolhido em faixa de ícones
 * e expõe isso em `data-menu`, que o layout usa para ajustar o recuo do conteúdo.
 */
export function MenuLateralProvider({ recolhidoInicial, className, children }: {
  recolhidoInicial: boolean
  className?: string
  children: React.ReactNode
}) {
  const [recolhido, setRecolhido] = useState(recolhidoInicial)

  const alternar = useCallback(() => {
    setRecolhido((atual) => {
      const novo = !atual
      document.cookie = `${COOKIE_MENU}=${novo ? 'recolhido' : 'aberto'}; path=/; max-age=31536000; samesite=lax`
      return novo
    })
  }, [])

  return (
    <Contexto.Provider value={{ recolhido, alternar }}>
      <div data-menu={recolhido ? 'recolhido' : 'aberto'} className={className}>
        {children}
      </div>
    </Contexto.Provider>
  )
}
