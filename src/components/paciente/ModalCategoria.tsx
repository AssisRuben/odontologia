'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const CATEGORIAS = [
  { value: 'CIRURGIA',                  color: '#EF4444' },
  { value: 'ENDODONTIA',               color: '#F59E0B' },
  { value: 'FALECIDO',                  color: '#6B7280' },
  { value: 'HOF',                       color: '#8B5CF6' },
  { value: 'IMPLANTE',                  color: '#3B82F6' },
  { value: 'INATIVO',                   color: '#9CA3AF' },
  { value: 'NECESSITA CUIDADO ESPECIAL',color: '#EF4444' },
  { value: 'ORTODONTIA',               color: '#10B981' },
  { value: 'PRÓTESE',                  color: '#F97316' },
  { value: 'VIP',                       color: '#EAB308' },
]

interface ModalCategoriaProps {
  open: boolean
  currentTags: string[]
  onClose: () => void
  onSave: (tags: string[]) => Promise<void>
}

export function ModalCategoria({ open, currentTags, onClose, onSave }: ModalCategoriaProps) {
  const [selected, setSelected] = useState<string[]>(currentTags)
  const [loading, setLoading] = useState(false)

  if (!open) return null

  function toggle(val: string) {
    setSelected((prev) =>
      prev.includes(val) ? prev.filter((t) => t !== val) : [...prev, val]
    )
  }

  async function handleSave() {
    setLoading(true)
    await onSave(selected)
    setLoading(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-5 border-b border-[#E5E7EB]">
          <h2 className="text-base font-semibold text-[#111827]">Categorizar paciente</h2>
          <button onClick={onClose} className="p-1 rounded text-[#6B7280] hover:text-[#111827]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5">
          <p className="text-sm text-[#6B7280] mb-4">Selecione uma ou mais categorias:</p>
          <div className="flex flex-wrap gap-2">
            {CATEGORIAS.map((cat) => {
              const active = selected.includes(cat.value)
              return (
                <button
                  key={cat.value}
                  onClick={() => toggle(cat.value)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs font-semibold border-2 transition-all',
                    active ? 'text-white border-transparent' : 'bg-white border-[#E5E7EB] text-[#374151]'
                  )}
                  style={active ? { backgroundColor: cat.color, borderColor: cat.color } : {}}
                >
                  {cat.value}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex gap-3 p-5 pt-0">
          <button
            onClick={onClose}
            className="flex-1 h-10 rounded-lg border border-[#E5E7EB] text-sm text-[#6B7280] hover:bg-[#F3F4F6] transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex-1 h-10 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-[#2563EB] transition-colors disabled:opacity-50"
          >
            {loading ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Mapeamento de cor por categoria
export const CATEGORIA_COLORS: Record<string, string> = Object.fromEntries(
  CATEGORIAS.map((c) => [c.value, c.color])
)
