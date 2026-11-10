'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AbaPendencias } from '@/components/convenios/AbaPendencias'
import { AbaLotes } from '@/components/convenios/AbaLotes'
import { AbaPagamentos } from '@/components/convenios/AbaPagamentos'

type Aba = 'pendencias' | 'lotes' | 'pagamentos'

const abas: { id: Aba; label: string }[] = [
  { id: 'pendencias', label: 'Pendências' },
  { id: 'lotes', label: 'Lotes' },
  { id: 'pagamentos', label: 'Pagamentos' },
]

function ConveniosConteudo() {
  const params = useSearchParams()
  const router = useRouter()
  const abaParam = params.get('aba')
  const aba: Aba = abaParam === 'lotes' || abaParam === 'pagamentos' ? abaParam : 'pendencias'
  const loteId = params.get('lote')

  return (
    <div>
      <div className="no-print px-4 sm:px-6 pt-4 sm:pt-6 pb-3">
        <h1 className="text-2xl sm:text-[26px] font-semibold text-tinta leading-tight">Convênios</h1>
      </div>
      <div className="no-print border-b border-linha px-6">
        <div className="flex gap-1">
          {abas.map((a) => (
            <button
              key={a.id}
              onClick={() => router.replace(a.id === 'pendencias' ? '/convenios' : `/convenios?aba=${a.id}`)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                aba === a.id ? 'border-petroleo text-petroleo' : 'border-transparent text-tinta-3 hover:text-tinta'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4 sm:p-6 max-w-5xl">
        {aba === 'pendencias' ? <AbaPendencias /> : aba === 'lotes' ? <AbaLotes loteInicial={loteId} /> : <AbaPagamentos />}
      </div>
    </div>
  )
}

export default function ConveniosPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-tinta-3">Carregando...</div>}>
      <ConveniosConteudo />
    </Suspense>
  )
}
