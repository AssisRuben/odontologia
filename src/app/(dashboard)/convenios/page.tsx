'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AbaPendencias } from '@/components/convenios/AbaPendencias'
import { AbaLotes } from '@/components/convenios/AbaLotes'

type Aba = 'pendencias' | 'lotes'

const abas: { id: Aba; label: string }[] = [
  { id: 'pendencias', label: 'Pendências' },
  { id: 'lotes', label: 'Lotes' },
]

function ConveniosConteudo() {
  const params = useSearchParams()
  const router = useRouter()
  const aba: Aba = params.get('aba') === 'lotes' ? 'lotes' : 'pendencias'
  const loteId = params.get('lote')

  return (
    <div>
      <div className="no-print bg-white border-b border-[#E5E7EB] px-6 py-4">
        <h1 className="text-xl font-semibold text-[#111827]">Convênios</h1>
      </div>
      <div className="no-print bg-white border-b border-[#E5E7EB] px-6">
        <div className="flex gap-1">
          {abas.map((a) => (
            <button
              key={a.id}
              onClick={() => router.replace(a.id === 'lotes' ? '/convenios?aba=lotes' : '/convenios')}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                aba === a.id ? 'border-[#3B82F6] text-[#3B82F6]' : 'border-transparent text-[#6B7280] hover:text-[#111827]'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4 sm:p-6 max-w-5xl">
        {aba === 'pendencias' ? <AbaPendencias /> : <AbaLotes loteInicial={loteId} />}
      </div>
    </div>
  )
}

export default function ConveniosPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[#6B7280]">Carregando...</div>}>
      <ConveniosConteudo />
    </Suspense>
  )
}
