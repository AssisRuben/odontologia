'use client'

import { createContext, useCallback, useContext, useState } from 'react'
import { COOKIE_MENU, COOKIE_PAINEL_AGENDA } from './menuLateralCookie'

type Preferencias = {
  /** Menu lateral em faixa de ícones (computador). */
  recolhido: boolean
  alternar: () => void
  /** Painel do dia à direita da agenda escondido (computador). */
  painelAgendaRecolhido: boolean
  alternarPainelAgenda: () => void
}

const Contexto = createContext<Preferencias>({
  recolhido: true, alternar: () => {}, painelAgendaRecolhido: true, alternarPainelAgenda: () => {},
})

export function useMenuLateral() {
  return useContext(Contexto)
}

/** Estado recolhido/aberto guardado num cookie, para o servidor já montar a página no tamanho certo. */
function usePreferencia(cookie: string, inicial: boolean) {
  const [recolhido, setRecolhido] = useState(inicial)
  const alternar = useCallback(() => {
    setRecolhido((atual) => {
      const novo = !atual
      document.cookie = `${cookie}=${novo ? 'recolhido' : 'aberto'}; path=/; max-age=31536000; samesite=lax`
      return novo
    })
  }, [cookie])
  return [recolhido, alternar] as const
}

/**
 * Envolve a área logada. Guarda se o menu lateral está recolhido em faixa de ícones e se o painel
 * do dia da agenda está escondido. O menu é exposto em `data-menu`, que o layout usa para o recuo do conteúdo.
 */
export function MenuLateralProvider({ recolhidoInicial, painelAgendaRecolhidoInicial, className, children }: {
  recolhidoInicial: boolean
  painelAgendaRecolhidoInicial: boolean
  className?: string
  children: React.ReactNode
}) {
  const [recolhido, alternar] = usePreferencia(COOKIE_MENU, recolhidoInicial)
  const [painelAgendaRecolhido, alternarPainelAgenda] = usePreferencia(COOKIE_PAINEL_AGENDA, painelAgendaRecolhidoInicial)

  return (
    <Contexto.Provider value={{ recolhido, alternar, painelAgendaRecolhido, alternarPainelAgenda }}>
      <div data-menu={recolhido ? 'recolhido' : 'aberto'} className={className}>
        {children}
      </div>
    </Contexto.Provider>
  )
}
