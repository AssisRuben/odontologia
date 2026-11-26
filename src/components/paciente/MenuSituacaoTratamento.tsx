'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { TreatmentStatus } from '@/types'

export interface OpcaoSituacao {
  value: TreatmentStatus
  label: string
  color: string
  bg: string
}

/** Etiqueta da situação do tratamento que abre a lista para trocar ali mesmo. */
export function MenuSituacaoTratamento({ atual, opcoes, procedimento, ocupado, onEscolher }: {
  atual: TreatmentStatus
  opcoes: OpcaoSituacao[]
  procedimento: string
  ocupado: boolean
  onEscolher: (novo: TreatmentStatus) => void
}) {
  const [aberto, setAberto] = useState(false)
  const raiz = useRef<HTMLDivElement>(null)
  const s = opcoes.find((o) => o.value === atual) ?? opcoes[0]

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => { if (raiz.current && !raiz.current.contains(e.target as Node)) setAberto(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false) }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc) }
  }, [aberto])

  return (
    <div ref={raiz} className="relative inline-flex">
      <button
        type="button"
        disabled={ocupado}
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-label={`Situação de ${procedimento}: ${s.label}. Mudar situação`}
        title="Mudar situação"
        className="inline-flex items-center gap-0.5 text-xs font-medium pl-2 pr-1.5 py-0.5 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current disabled:cursor-wait disabled:opacity-60"
        style={{ backgroundColor: s.bg, color: s.color, boxShadow: aberto ? `0 0 0 2px #fff, 0 0 0 3.5px ${s.color}` : undefined }}
      >
        {s.label}
        <ChevronDown className="w-3 h-3" aria-hidden="true" />
      </button>
      {aberto && (
        <div role="menu" aria-label="Situação do tratamento" className="absolute left-0 top-full mt-1.5 z-20 w-44 rounded-xl border border-linha bg-white p-1 shadow-[0_12px_28px_-10px_rgba(23,59,71,0.35)]">
          {opcoes.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === atual}
              onClick={() => { setAberto(false); onEscolher(o.value) }}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm text-left text-tinta hover:bg-porcelana-2 focus-visible:bg-porcelana-2 focus-visible:outline-none ${o.value === atual ? 'font-semibold bg-porcelana-2' : ''}`}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: o.color }} aria-hidden="true" />
              {o.label}
              {o.value === atual && <Check className="w-3.5 h-3.5 ml-auto text-petroleo" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
