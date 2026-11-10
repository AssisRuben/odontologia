'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import type { InventoryItem, Kit } from '@/types'
import { ModalKit } from './ModalKit'

function saldoBaixo(kit: Kit): boolean {
  return (kit.items ?? []).some((ki) => !ki.item || ki.item.active === false || ki.item.quantity < ki.quantity)
}

export function TabKits({ produtos }: { produtos: InventoryItem[] }) {
  const [kits, setKits] = useState<Kit[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(false)
  const [versao, setVersao] = useState(0)
  const [janela, setJanela] = useState<{ kit: Kit | null } | null>(null)

  useEffect(() => {
    let cancelado = false
    fetch('/api/estoque/kits')
      .then(async (res) => {
        if (!res.ok) throw new Error('falha')
        return res.json()
      })
      .then((j) => {
        if (cancelado) return
        setKits(j.kits ?? [])
        setErro(false)
        setLoading(false)
      })
      .catch(() => {
        if (cancelado) return
        setErro(true)
        setLoading(false)
      })
    return () => { cancelado = true }
  }, [versao])

  const ordenados = useMemo(
    () => [...kits].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'pt-BR')),
    [kits],
  )

  function tentarDeNovo() {
    setLoading(true)
    setErro(false)
    setVersao((v) => v + 1)
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button onClick={() => setJanela({ kit: null })}
          className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-petroleo text-white rounded-lg text-sm font-medium hover:bg-petroleo-escuro transition-colors shrink-0">
          <Plus className="w-4 h-4" />
          Novo kit
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-6 h-6 border-2 border-petroleo border-t-transparent rounded-full animate-spin" />
        </div>
      ) : erro ? (
        <div className="flex flex-col items-center justify-center h-48 gap-3">
          <p className="text-sm text-tinta-3">Não foi possível carregar os kits.</p>
          <button onClick={tentarDeNovo} className="px-4 py-2 rounded-lg border border-linha text-sm text-tinta hover:bg-porcelana-2">Tentar de novo</button>
        </div>
      ) : ordenados.length === 0 ? (
        <p className="text-sm text-tinta-3 text-center py-12">Nenhum kit cadastrado. Crie um kit com os materiais usados em cada procedimento.</p>
      ) : (
        <ul className="rounded-lg border border-linha divide-y divide-linha bg-white">
          {ordenados.map((kit) => {
            const n = kit.items?.length ?? 0
            return (
              <li key={kit.id}>
                <button onClick={() => setJanela({ kit })}
                  className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-porcelana-2 transition-colors">
                  <span className={`text-sm font-medium ${kit.active ? 'text-tinta' : 'text-tinta-3'}`}>{kit.name}</span>
                  <span className="text-xs text-tinta-3">{n} {n === 1 ? 'produto' : 'produtos'}</span>
                  {!kit.active && <span className="text-xs px-2 py-0.5 rounded-full bg-porcelana-2 text-tinta-3">Inativo</span>}
                  {saldoBaixo(kit) && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">Saldo baixo</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {janela && (
        <ModalKit
          kit={janela.kit}
          produtos={produtos}
          onClose={() => setJanela(null)}
          onSaved={() => { setJanela(null); setVersao((v) => v + 1) }}
        />
      )}
    </div>
  )
}
