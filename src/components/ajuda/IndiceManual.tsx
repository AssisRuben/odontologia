'use client'

import { useEffect, useState } from 'react'
import { List, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Capitulo, Parte } from '@/content/ajuda/indice'

type Props = { partes: Parte[]; capitulos: Capitulo[] }

// Índice do manual: coluna fixa no computador, botão "Índice" no celular.
// Destaca o capítulo que está na tela.
export function IndiceManual({ partes, capitulos }: Props) {
  const [ativo, setAtivo] = useState(capitulos[0]?.slug)
  const [aberto, setAberto] = useState(false)

  useEffect(() => {
    const secoes = capitulos
      .map(c => document.getElementById(c.slug))
      .filter((el): el is HTMLElement => !!el)
    const obs = new IntersectionObserver(
      entradas => {
        const visivel = entradas.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (visivel) setAtivo(visivel.target.id)
      },
      { rootMargin: '-80px 0px -60% 0px' },
    )
    secoes.forEach(s => obs.observe(s))
    return () => obs.disconnect()
  }, [capitulos])

  const lista = (
    <nav aria-label="Índice do manual" className="space-y-4">
      {partes.map((parte, i) => (
        <div key={parte}>
          <p className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-wide text-tinta-4">
            Parte {['I', 'II', 'III', 'IV'][i]} · {parte}
          </p>
          <ul className="space-y-0.5">
            {capitulos.filter(c => c.parte === parte).map(c => (
              <li key={c.slug}>
                <a href={`#${c.slug}`} onClick={() => setAberto(false)}
                  aria-current={ativo === c.slug ? 'location' : undefined}
                  className={cn(
                    'block px-2 py-1 rounded-md text-sm transition-colors',
                    ativo === c.slug ? 'bg-petroleo-50 text-petroleo font-medium' : 'text-tinta-3 hover:text-tinta hover:bg-porcelana',
                  )}>
                  {c.titulo}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )

  return (
    <>
      {/* Computador */}
      <aside className="hidden md:block print:hidden w-60 shrink-0">
        <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2">{lista}</div>
      </aside>

      {/* Celular */}
      <div className="md:hidden print:hidden mb-4">
        <button type="button" onClick={() => setAberto(a => !a)} aria-expanded={aberto}
          className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-linha bg-white text-sm text-tinta">
          {aberto ? <X className="w-4 h-4" /> : <List className="w-4 h-4" />} Índice
        </button>
        {aberto && <div className="mt-2 p-3 rounded-lg border border-linha bg-white">{lista}</div>}
      </div>
    </>
  )
}
