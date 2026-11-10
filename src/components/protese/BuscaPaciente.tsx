'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import { filtroBuscaPaciente } from '@/lib/busca/pacientes'

type Paciente = { id: string; name: string }

interface Props {
  value: Paciente | null
  onChange: (v: Paciente | null) => void
  disabled?: boolean
}

const inputCls = 'w-full h-10 px-3 rounded-lg border border-linha text-sm bg-white focus:outline-none focus:ring-2 focus:ring-petroleo disabled:bg-porcelana'

/** Campo de busca de paciente por nome, telefone ou CPF (até 8 resultados). */
export function BuscaPaciente({ value, onChange, disabled }: Props) {
  const { clinicId } = useClinicStore()
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState<Paciente[]>([])

  useEffect(() => {
    const filtro = filtroBuscaPaciente(termo)
    if (!clinicId || !filtro) return
    let cancelado = false
    const t = setTimeout(() => {
      createClient().from('patients').select('id, name')
        .eq('clinic_id', clinicId).or(filtro).order('name').limit(8)
        .then(({ data }) => { if (!cancelado) setResultados((data as Paciente[] | null) ?? []) })
    }, 250)
    return () => { cancelado = true; clearTimeout(t) }
  }, [termo, clinicId])

  if (value) {
    return (
      <div className="flex items-center justify-between h-10 px-3 rounded-lg border border-linha bg-porcelana text-sm text-tinta">
        <span className="truncate">{value.name}</span>
        {!disabled && (
          <button type="button" onClick={() => { onChange(null); setTermo(''); setResultados([]) }}
            className="p-1 text-tinta-4 hover:text-tinta-2" aria-label="Trocar paciente">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    )
  }

  const lista = filtroBuscaPaciente(termo) ? resultados : []
  return (
    <div className="relative">
      <input value={termo} onChange={(e) => setTermo(e.target.value)} disabled={disabled}
        placeholder="Buscar por nome, telefone ou CPF" className={inputCls} />
      {lista.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full bg-white rounded-lg border border-linha shadow-lg max-h-56 overflow-y-auto">
          {lista.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onChange(p)}
                className="w-full text-left px-3 py-2 text-sm text-tinta hover:bg-porcelana">
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
