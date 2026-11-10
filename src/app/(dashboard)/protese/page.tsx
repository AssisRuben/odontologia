'use client'

import { useState, useEffect } from 'react'
import { Plus } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import type { Prosthetic, ProstheticStatus } from '@/types'

const columns: { id: ProstheticStatus; label: string; color: string }[] = [
  { id: 'requested',   label: 'Solicitação',            color: '#F59E0B' },
  { id: 'sent_to_lab', label: 'Enviado ao Laboratório', color: '#173B47' },
  { id: 'returned',    label: 'Retornado à Clínica',    color: '#8B5CF6' },
  { id: 'installed',   label: 'Instalado',              color: '#10B981' },
]

export default function ProtesePage() {
  const { clinicId, loading: clinicLoading } = useClinicStore()
  const [items, setItems] = useState<Prosthetic[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clinicId) return
    async function load() {
      const supabase = createClient()
      const { data } = await supabase
        .from('prosthetics')
        .select('*, patient:patients(name), professional:professionals(name)')
        .eq('clinic_id', clinicId!)
      setItems(data || [])
      setLoading(false)
    }
    load()
  }, [clinicId])

  async function moveItem(id: string, newStatus: ProstheticStatus) {
    const supabase = createClient()
    await supabase.from('prosthetics').update({ status: newStatus }).eq('id', id)
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, status: newStatus } : i))
  }

  if (clinicLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)]">
        <div className="w-8 h-8 border-2 border-petroleo border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col">
      <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-3 flex items-center justify-between gap-3">
        <h1 className="text-2xl sm:text-[26px] font-semibold text-tinta leading-tight">Prótese</h1>
        <button className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-petroleo text-white rounded-lg text-sm font-medium hover:bg-petroleo-escuro transition-colors shrink-0">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Nova solicitação</span>
          <span className="sm:hidden">Nova</span>
        </button>
      </div>

      <div className="flex-1 overflow-x-auto p-3 sm:p-6">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-6 h-6 border-2 border-petroleo border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="flex gap-4 min-w-max xl:min-w-0 h-full">
            {columns.map((col) => {
              const colItems = items.filter((i) => i.status === col.id)
              return (
                <div key={col.id} className="w-72 xl:w-auto xl:flex-1 xl:min-w-0 flex flex-col">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: col.color }} />
                    <span className="text-sm font-semibold text-tinta">{col.label}</span>
                    <span className="ml-auto bg-porcelana text-tinta-3 text-xs font-medium rounded-full w-6 h-6 flex items-center justify-center">
                      {colItems.length}
                    </span>
                  </div>

                  <div className="flex-1 bg-porcelana-2 rounded-xl p-3 space-y-3 min-h-[200px]">
                    {colItems.length === 0 ? (
                      <div className="flex items-center justify-center h-24 text-xs text-tinta-4">
                        Nenhum item
                      </div>
                    ) : (
                      colItems.map((item) => (
                        <div key={item.id} className="bg-white rounded-lg border border-linha p-3 shadow-sm">
                          <p className="font-medium text-sm text-tinta truncate">
                            {item.patient?.name || 'Paciente'}
                          </p>
                          <p className="text-xs text-tinta-3 mt-1">{item.type || 'Prótese'}</p>
                          {item.laboratory && (
                            <p className="text-xs text-tinta-4">Lab: {item.laboratory}</p>
                          )}
                          {item.expected_at && (
                            <p className="text-xs text-tinta-4">
                              Prev: {format(parseISO(item.expected_at), 'dd/MM/yyyy', { locale: ptBR })}
                            </p>
                          )}
                          {item.notes && (
                            <p className="text-xs text-tinta-4 mt-1 italic truncate">{item.notes}</p>
                          )}
                          <div className="flex gap-1 mt-2 flex-wrap">
                            {columns.filter((c) => c.id !== col.id).map((c) => (
                              <button key={c.id} onClick={() => moveItem(item.id, c.id)}
                                className="text-xs px-2 py-0.5 rounded border transition-colors hover:opacity-80"
                                style={{ borderColor: c.color, color: c.color }}>
                                → {c.label.split(' ')[0]}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
