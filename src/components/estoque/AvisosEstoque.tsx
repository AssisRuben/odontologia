'use client'

import { AlertTriangle } from 'lucide-react'

export type FiltroAviso = 'baixo' | 'vencidos' | 'vencendo' | null

interface Props {
  resumo: { baixo: number; vencidos: number; vencendo: number }
  filtro: FiltroAviso
  onFiltro: (f: FiltroAviso) => void
}

export function AvisosEstoque({ resumo, filtro, onFiltro }: Props) {
  const avisos: { chave: Exclude<FiltroAviso, null>; n: number; texto: string; cor: string }[] = [
    { chave: 'baixo', n: resumo.baixo, texto: `${resumo.baixo} abaixo do mínimo`, cor: 'bg-red-50 border-red-200 text-red-700' },
    { chave: 'vencidos', n: resumo.vencidos, texto: `${resumo.vencidos} ${resumo.vencidos === 1 ? 'lote vencido' : 'lotes vencidos'}`, cor: 'bg-red-50 border-red-200 text-red-700' },
    { chave: 'vencendo', n: resumo.vencendo, texto: `${resumo.vencendo} vencendo em 30 dias`, cor: 'bg-amber-50 border-amber-200 text-amber-700' },
  ]
  const visiveis = avisos.filter((a) => a.n > 0)
  if (visiveis.length === 0) return null
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {visiveis.map((a) => (
        <button
          key={a.chave}
          type="button"
          aria-pressed={filtro === a.chave}
          onClick={() => onFiltro(filtro === a.chave ? null : a.chave)}
          className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-shadow ${a.cor} ${filtro === a.chave ? 'ring-2 ring-petroleo' : ''}`}
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {a.texto}
        </button>
      ))}
    </div>
  )
}
