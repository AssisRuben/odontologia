'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'

export default function AsaasBanner() {
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    let active = true
    fetch('/api/payments/connection', { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then((data: { connected?: boolean; status?: string } | null) => {
        if (active && data?.connected && data.status === 'invalid_key') setInvalid(true)
      })
      .catch(() => { /* sem banner se a consulta falhar */ })
    return () => { active = false }
  }, [])

  if (!invalid) return null

  return (
    <div role="alert" className="flex items-start gap-2 bg-amber-50 border-b border-amber-200 px-4 sm:px-6 py-3 text-sm text-amber-800">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <p>
        A chave do Asaas não é mais válida. Reconecte o Asaas em{' '}
        <Link href="/configuracoes/pagamentos" className="font-medium underline">Configurações → Pagamentos</Link>.
      </p>
    </div>
  )
}
