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
export function BuscaRapida({ className, variante = 'icone' }: { className?: string; variante?: 'icone' | 'campo' }) {
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
      {variante === 'campo' ? (
        <button
          onClick={() => setOpen(true)}
          title="Buscar paciente (Ctrl+K)"
          className={cn('items-center gap-2 w-72 px-3 py-2 rounded-[10px] bg-white text-sm text-tinta-4 ring-1 ring-inset ring-linha hover:ring-linha-forte transition-shadow', className)}
        >
          <Search className="w-4 h-4" />
          Buscar paciente
          <kbd className="ml-auto text-[11px] font-medium text-tinta-4 border border-linha rounded-[5px] px-1.5 py-px">Ctrl K</kbd>
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          title="Buscar paciente (Ctrl+K)"
          aria-label="Buscar paciente"
          className={cn('p-2 rounded-md text-tinta-3 hover:bg-porcelana transition-colors', className)}
        >
          <Search className="w-4 h-4" />
        </button>
      )}
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
        className="w-full max-w-lg bg-white rounded-xl shadow-2xl border border-linha overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 px-3 border-b border-linha">
          <Search className="w-4 h-4 text-tinta-4 shrink-0" />
          <input
            ref={inputRef}
            value={termo}
            onChange={(e) => { setTermo(e.target.value); setBuscando(filtroBuscaPaciente(e.target.value) !== null) }}
            placeholder="Nome, telefone ou CPF do paciente"
            className="flex-1 py-3 text-sm outline-none bg-transparent"
          />
          {buscando && <Loader2 className="w-4 h-4 text-tinta-4 animate-spin shrink-0" />}
          <button onClick={onClose} aria-label="Fechar" className="p-1 rounded text-tinta-4 hover:bg-porcelana">
            <X className="w-4 h-4" />
          </button>
        </div>

        {temTermo && !buscando && lista.length === 0 && (
          <p className="px-4 py-6 text-sm text-center text-tinta-3">Nenhum paciente encontrado.</p>
        )}
        {!temTermo && (
          <p className="px-4 py-4 text-xs text-tinta-4">Digite pelo menos 2 letras. Use ↑ ↓ e Enter para abrir a ficha.</p>
        )}
        {lista.length > 0 && (
          <ul className="max-h-80 overflow-y-auto py-1">
            {lista.map((r, i) => (
              <li key={r.id}>
                <button
                  onClick={() => abrir(r)}
                  onMouseEnter={() => setAtivo(i)}
                  className={cn('w-full text-left px-4 py-2 flex items-center gap-3', i === ativo && 'bg-petroleo-50')}
                >
                  <span className="w-8 h-8 rounded-full bg-petroleo-100 text-petroleo-escuro text-xs font-semibold flex items-center justify-center shrink-0">
                    {r.name.trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-tinta truncate">{r.name}</span>
                    <span className="flex items-center gap-2 text-xs text-tinta-3 truncate">
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
