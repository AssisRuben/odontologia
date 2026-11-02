'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'

const POLL_MS = 2 * 60_000
const SETTINGS_PATH = '/configuracoes/mensagens'

interface StatusPayload {
  status: 'disconnected' | 'connecting' | 'connected'
  everConnected: boolean
}

/** Faixa vermelha quando o WhatsApp da clínica já esteve conectado e caiu. */
export function WhatsAppBanner() {
  const pathname = usePathname()
  const [down, setDown] = useState(false)

  useEffect(() => {
    let active = true
    async function check() {
      try {
        const res = await fetch('/api/whatsapp/status', { cache: 'no-store' })
        if (!res.ok) return // 401 e demais erros: sem alteração, sem faixa
        const data = (await res.json()) as StatusPayload
        if (active) setDown(Boolean(data.everConnected) && data.status !== 'connected')
      } catch {
        // falha de rede: ignora silenciosamente
      }
    }
    check()
    const timer = setInterval(check, POLL_MS)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])

  if (!down || pathname?.startsWith(SETTINGS_PATH)) return null

  return (
    <div
      role="alert"
      className="fixed inset-x-4 bottom-20 md:bottom-4 z-40 mx-auto max-w-2xl rounded-xl shadow-lg bg-[#DC2626] text-white text-sm px-4 py-2.5 flex items-center justify-center gap-2 flex-wrap"
    >
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span>WhatsApp desconectado — as mensagens automáticas estão pausadas.</span>
      <Link href={SETTINGS_PATH} className="font-semibold underline underline-offset-2 hover:opacity-90">
        Reconectar
      </Link>
    </div>
  )
}
