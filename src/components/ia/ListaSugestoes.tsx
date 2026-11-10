'use client'

import type { Sugestao } from '@/lib/ia/evolucao/sugestoes'

interface ListaSugestoesProps {
  sugestoes: Sugestao[]
  marcadas: boolean[]
  onToggle: (i: number) => void
}

export function ListaSugestoes({ sugestoes, marcadas, onToggle }: ListaSugestoesProps) {
  if (sugestoes.length === 0) return null
  return (
    <div className="rounded-xl border border-linha bg-porcelana-2 p-3">
      <p className="text-xs font-semibold text-tinta-3 uppercase tracking-wide mb-2">Sugestões da IA</p>
      <ul className="space-y-1.5">
        {sugestoes.map((s, i) => (
          <li key={i}>
            <label className="flex items-start gap-2 text-sm text-tinta cursor-pointer">
              <input
                type="checkbox"
                checked={marcadas[i] ?? false}
                onChange={() => onToggle(i)}
                className="mt-0.5 accent-petroleo"
              />
              <span>{s.descricao}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}
