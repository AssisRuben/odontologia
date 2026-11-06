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
    <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-3">
      <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-2">Sugestões da IA</p>
      <ul className="space-y-1.5">
        {sugestoes.map((s, i) => (
          <li key={i}>
            <label className="flex items-start gap-2 text-sm text-[#111827] cursor-pointer">
              <input
                type="checkbox"
                checked={marcadas[i] ?? false}
                onChange={() => onToggle(i)}
                className="mt-0.5 accent-[#3B82F6]"
              />
              <span>{s.descricao}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}
