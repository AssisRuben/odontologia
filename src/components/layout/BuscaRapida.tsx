'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X, Phone, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import { filtroBuscaPaciente } from '@/lib/busca/pacientes'
import { cn } from '@/lib/utils'

type Resultado = {
  id: string
  name: string
  phone: string | null
  cpf: string | null
  insurance_plan: { name: string } | null
}

/** Lupa da barra do topo: busca pacientes pelo nome, telefone ou CPF e abre a ficha. */
export function BuscaRapida({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)

  // Ctrl+K / Cmd+K abre de qualquer tela.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Buscar paciente (Ctrl+K)"
        aria-label="Buscar paciente"
        className={cn('p-2 rounded-md text-[#6B7280] hover:bg-[#F3F4F6] transition-colors', className)}
      >
        <Search className="w-4 h-4" />
      </button>
      {open && <JanelaBusca onClose={() => setOpen(false)} />}
    </>
  )
}

function JanelaBusca({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const { clinicId } = useClinicStore()
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState<Resultado[]>([])
  const [buscando, setBuscando] = useState(false)
  const [ativo, setAtivo] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Espera a pessoa parar de digitar antes de consultar o banco.
  useEffect(() => {
    const filtro = filtroBuscaPaciente(termo)
    if (!clinicId || !filtro) return
    let cancelado = false
    const t = setTimeout(async () => {
      const { data } = await createClient()
        .from('patients')
        .select('id, name, phone, cpf, insurance_plan:insurance_plans(name)')
        .eq('clinic_id', clinicId)
        .or(filtro)
        .order('name')
        .limit(8)
      if (cancelado) return
      setResultados((data as unknown as Resultado[]) ?? [])
      setAtivo(0)
      setBuscando(false)
    }, 200)
    return () => { cancelado = true; clearTimeout(t) }
  }, [termo, clinicId])

  function abrir(r: Resultado) {
    onClose()
    router.push(`/pacientes/${r.id}`)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') { e.preventDefault(); setAtivo((i) => Math.min(i + 1, lista.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && lista[ativo]) { e.preventDefault(); abrir(lista[ativo]) }
  }

  const temTermo = filtroBuscaPaciente(termo) !== null
  const lista = temTermo ? resultados : []

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center px-3 pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Buscar paciente"
        className="w-full max-w-lg bg-white rounded-xl shadow-2xl border border-[#E5E7EB] overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 px-3 border-b border-[#E5E7EB]">
          <Search className="w-4 h-4 text-[#9CA3AF] shrink-0" />
          <input
            ref={inputRef}
            value={termo}
            onChange={(e) => { setTermo(e.target.value); setBuscando(filtroBuscaPaciente(e.target.value) !== null) }}
            placeholder="Nome, telefone ou CPF do paciente"
            className="flex-1 py-3 text-sm outline-none bg-transparent"
          />
          {buscando && <Loader2 className="w-4 h-4 text-[#9CA3AF] animate-spin shrink-0" />}
          <button onClick={onClose} aria-label="Fechar" className="p-1 rounded text-[#9CA3AF] hover:bg-[#F3F4F6]">
            <X className="w-4 h-4" />
          </button>
        </div>

        {temTermo && !buscando && lista.length === 0 && (
          <p className="px-4 py-6 text-sm text-center text-[#6B7280]">Nenhum paciente encontrado.</p>
        )}
        {!temTermo && (
          <p className="px-4 py-4 text-xs text-[#9CA3AF]">Digite pelo menos 2 letras. Use ↑ ↓ e Enter para abrir a ficha.</p>
        )}
        {lista.length > 0 && (
          <ul className="max-h-80 overflow-y-auto py-1">
            {lista.map((r, i) => (
              <li key={r.id}>
                <button
                  onClick={() => abrir(r)}
                  onMouseEnter={() => setAtivo(i)}
                  className={cn('w-full text-left px-4 py-2 flex items-center gap-3', i === ativo && 'bg-[#EFF6FF]')}
                >
                  <span className="w-8 h-8 rounded-full bg-[#DBEAFE] text-[#2563EB] text-xs font-semibold flex items-center justify-center shrink-0">
                    {r.name.trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-[#111827] truncate">{r.name}</span>
                    <span className="flex items-center gap-2 text-xs text-[#6B7280] truncate">
                      {r.phone && <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" />{r.phone}</span>}
                      {r.insurance_plan?.name && <span>{r.insurance_plan.name}</span>}
                      {!r.phone && !r.insurance_plan?.name && r.cpf && <span>CPF {r.cpf}</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
