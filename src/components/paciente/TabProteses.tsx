'use client'

import { useState, useEffect, useRef } from 'react'
import { Plus } from 'lucide-react'
import type { Prosthetic } from '@/types'
import { CartaoProtese } from '@/components/protese/CartaoProtese'
import { ModalProtese } from '@/components/protese/ModalProtese'

interface Props {
  patient: { id: string; name: string }
}

export function TabProteses({ patient }: Props) {
  const [items, setItems] = useState<Prosthetic[]>([])
  const [hojeYmd, setHojeYmd] = useState('')
  const [loading, setLoading] = useState(true)
  const [erroCarga, setErroCarga] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [modal, setModal] = useState<{ protese?: Prosthetic } | null>(null)
  const [aviso, setAviso] = useState('')
  const avisoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelado = false
    fetch(`/api/protese?paciente=${encodeURIComponent(patient.id)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('falha')
        return res.json() as Promise<{ hoje: string; itens: Prosthetic[] }>
      })
      .then((json) => {
        if (cancelado) return
        setItems(json.itens)
        setHojeYmd(json.hoje)
        setErroCarga(false)
      })
      .catch(() => {
        if (!cancelado) setErroCarga(true)
      })
      .finally(() => {
        if (!cancelado) setLoading(false)
      })
    return () => { cancelado = true }
  }, [patient.id, reloadKey])

  useEffect(() => () => { if (avisoTimer.current) clearTimeout(avisoTimer.current) }, [])

  function mostrarAviso(msg: string) {
    setAviso(msg)
    if (avisoTimer.current) clearTimeout(avisoTimer.current)
    avisoTimer.current = setTimeout(() => setAviso(''), 4000)
  }

  function tentarDeNovo() {
    setLoading(true)
    setErroCarga(false)
    setReloadKey((k) => k + 1)
  }

  return (
    <div>
      {aviso && (
        <div role="status" className="mb-3 px-4 py-2 rounded-lg bg-gengiva-50 text-gengiva-escuro text-sm font-medium">
          {aviso}
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-tinta">Próteses</h3>
        <button onClick={() => setModal({})}
          className="flex items-center gap-1.5 px-3 h-8 bg-petroleo text-white text-xs font-medium rounded-lg hover:bg-petroleo-escuro transition-colors">
          <Plus className="w-3.5 h-3.5" /> Nova prótese
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-6 h-6 border-2 border-petroleo border-t-transparent rounded-full animate-spin" />
        </div>
      ) : erroCarga ? (
        <div className="flex flex-col items-center justify-center h-32 gap-3">
          <p className="text-sm text-tinta-2">Não foi possível carregar as próteses. Tente de novo.</p>
          <button onClick={tentarDeNovo}
            className="px-4 py-2 bg-petroleo text-white rounded-lg text-sm font-medium hover:bg-petroleo-escuro transition-colors">
            Tentar de novo
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-linha flex items-center justify-center h-28 text-sm text-tinta-3">
          Nenhuma prótese para este paciente.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {items.map((item) => (
            <CartaoProtese
              key={item.id}
              protese={item}
              hojeYmd={hojeYmd}
              mostrarEtapa
              onAbrir={() => setModal({ protese: item })}
            />
          ))}
        </div>
      )}

      {modal && (
        <ModalProtese
          protese={modal.protese}
          pacienteFixo={patient}
          onClose={() => setModal(null)}
          onSaved={(msg) => {
            setModal(null)
            if (msg) mostrarAviso(msg)
            setReloadKey((k) => k + 1)
          }}
        />
      )}
    </div>
  )
}
