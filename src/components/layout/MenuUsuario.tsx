'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { LogOut, Settings, User } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'

/** Iniciais do nome (ex.: "Marco Fiusa" → "MF"). */
function iniciais(nome: string | null): string {
  if (!nome) return ''
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return ''
  const primeira = partes[0][0]
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : ''
  return (primeira + ultima).toUpperCase()
}

/** Avatar do topo: mostra quem está logado e permite sair. */
export function MenuUsuario() {
  const { professionalName } = useClinicStore()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [saindo, setSaindo] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Fecha ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  // E-mail do login: busca na primeira vez que o menu abre.
  useEffect(() => {
    if (!open || email !== null) return
    let cancelado = false
    createClient().auth.getUser().then(({ data }) => {
      if (!cancelado) setEmail(data.user?.email ?? '')
    })
    return () => { cancelado = true }
  }, [open, email])

  async function sair() {
    setSaindo(true)
    try {
      await createClient().auth.signOut()
    } finally {
      window.location.href = '/login'
    }
  }

  const sigla = iniciais(professionalName)

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Menu do usuário"
        title={professionalName ?? 'Usuário'}
        className="w-8 h-8 rounded-full bg-[#3B82F6] hover:bg-[#2563EB] flex items-center justify-center text-white text-xs font-semibold ml-1 transition-colors"
      >
        {sigla || <User className="w-4 h-4" />}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl shadow-xl border border-[#E5E7EB] z-50 overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-[#E5E7EB]">
            <p className="text-sm font-semibold text-[#111827] truncate">{professionalName ?? 'Usuário'}</p>
            <p className="text-xs text-[#6B7280] truncate">{email === null ? 'Carregando…' : email}</p>
          </div>

          <Link
            href="/configuracoes"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-4 py-2.5 text-sm text-[#374151] hover:bg-[#F9FAFB]"
          >
            <Settings className="w-4 h-4 text-[#6B7280]" />
            Configurações
          </Link>

          <button
            role="menuitem"
            onClick={sair}
            disabled={saindo}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#DC2626] hover:bg-[#FEF2F2] border-t border-[#F3F4F6] disabled:opacity-60"
          >
            <LogOut className="w-4 h-4" />
            {saindo ? 'Saindo…' : 'Sair'}
          </button>
        </div>
      )}
    </div>
  )
}
