'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { Pendencia } from '@/lib/convenios/pendencias'

export function AbaPendencias() {
  const [itens, setItens] = useState<Pendencia[] | null>(null)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    try {
      const res = await fetch('/api/convenios/pendencias', { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErro(json.error || 'Não foi possível carregar as pendências')
        return
      }
      setErro('')
      setItens(json.itens ?? [])
    } catch {
      setErro('Não foi possível carregar as pendências')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregar()
    window.addEventListener('convenios:changed', carregar)
    return () => window.removeEventListener('convenios:changed', carregar)
  }, [carregar])

  if (erro) return <p className="text-sm text-[#DC2626]">{erro}</p>
  if (!itens) return <p className="text-sm text-[#6B7280]">Carregando...</p>
  if (itens.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-[#E5E7EB] p-8 text-center text-sm text-[#6B7280]">
        Nenhuma pendência de convênio.
      </div>
    )
  }

  return (
    <ul className="bg-white rounded-xl border border-[#E5E7EB] divide-y divide-[#E5E7EB]">
      {itens.map((p, i) => (
        <li key={`${p.tipo}-${i}`}>
          <Link href={p.href} className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-[#111827] hover:bg-[#F9FAFB]">
            <span>{p.texto}</span>
            <span className="text-[#3B82F6] shrink-0">Abrir</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
