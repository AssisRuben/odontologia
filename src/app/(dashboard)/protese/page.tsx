'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Plus } from 'lucide-react'
import { useClinicStore } from '@/store/clinicStore'
import type { Prosthetic, ProstheticStatus } from '@/types'
import { ETAPAS } from '@/lib/protese/etapas'
import { diasDeAtraso } from '@/lib/protese/atraso'
import { formatValor } from '@/lib/messaging/time'
import { CartaoProtese } from '@/components/protese/CartaoProtese'
import { ModalProtese } from '@/components/protese/ModalProtese'
import { DialogMover } from '@/components/protese/DialogMover'

const selectCls = 'h-9 px-2 rounded-lg border border-linha text-sm bg-white text-tinta focus:outline-none focus:ring-2 focus:ring-petroleo'

export default function ProtesePage() {
  const { clinicId, loading: clinicLoading } = useClinicStore()
  const [items, setItems] = useState<Prosthetic[]>([])
  const [hojeYmd, setHojeYmd] = useState('')
  const [loading, setLoading] = useState(true)
  const [erroCarga, setErroCarga] = useState(false)
  const [todas, setTodas] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const [filtroDentista, setFiltroDentista] = useState('')
  const [filtroLab, setFiltroLab] = useState('')
  const [soAtrasadas, setSoAtrasadas] = useState(false)

  const [modal, setModal] = useState<{ protese?: Prosthetic } | null>(null)
  const [mover, setMover] = useState<{ protese: Prosthetic; para: ProstheticStatus } | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [aviso, setAviso] = useState('')
  const avisoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!clinicId) return
    let cancelado = false
    fetch(`/api/protese${todas ? '?instaladas=todas' : ''}`)
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
        if (cancelado) return
        setLoading(false)
        setOcupado(null)
      })
    return () => { cancelado = true }
  }, [clinicId, todas, reloadKey])

  useEffect(() => () => { if (avisoTimer.current) clearTimeout(avisoTimer.current) }, [])

  const recarregar = useCallback(() => setReloadKey((k) => k + 1), [])

  function mostrarAviso(msg: string) {
    setAviso(msg)
    if (avisoTimer.current) clearTimeout(avisoTimer.current)
    avisoTimer.current = setTimeout(() => setAviso(''), 4000)
  }

  function tentarDeNovo() {
    setLoading(true)
    setErroCarga(false)
    recarregar()
  }

  const dentistas = useMemo(() => {
    const m = new Map<string, string>()
    for (const i of items) if (i.professional?.id) m.set(i.professional.id, i.professional.name)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
  }, [items])

  const labs = useMemo(() => {
    const m = new Map<string, string>()
    for (const i of items) if (i.lab?.id) m.set(i.lab.id, i.lab.name)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
  }, [items])

  // Filtro cuja opção sumiu (ex.: "Ver todas", recarga) vale como "Todos".
  const dentistaSel = dentistas.some(([id]) => id === filtroDentista) ? filtroDentista : ''
  const labSel = labs.some(([id]) => id === filtroLab) ? filtroLab : ''

  const filtrados = items.filter((i) =>
    (!dentistaSel || i.professional?.id === dentistaSel) &&
    (!labSel || i.lab?.id === labSel) &&
    (!soAtrasadas || diasDeAtraso(i, hojeYmd) > 0),
  )

  if (clinicLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)]">
        <div className="w-8 h-8 border-2 border-petroleo border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col">
      {aviso && (
        <div role="status" className="mx-4 sm:mx-6 mt-3 px-4 py-2 rounded-lg bg-gengiva-50 text-gengiva-escuro text-sm font-medium">
          {aviso}
        </div>
      )}
      <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl sm:text-[26px] font-semibold text-tinta leading-tight">Prótese</h1>
        <div className="order-3 sm:order-2 w-full sm:w-auto flex flex-wrap items-center gap-2 sm:ml-auto">
          <select aria-label="Dentista" value={dentistaSel} onChange={(e) => setFiltroDentista(e.target.value)} className={selectCls}>
            <option value="">Todos os dentistas</option>
            {dentistas.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select aria-label="Laboratório" value={labSel} onChange={(e) => setFiltroLab(e.target.value)} className={selectCls}>
            <option value="">Todos os laboratórios</option>
            {labs.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-tinta-2">
            <input type="checkbox" checked={soAtrasadas} onChange={(e) => setSoAtrasadas(e.target.checked)} />
            Só atrasadas
          </label>
        </div>
        <button onClick={() => setModal({})}
          className="order-2 sm:order-3 flex items-center gap-2 px-3 sm:px-4 py-2 bg-petroleo text-white rounded-lg text-sm font-medium hover:bg-petroleo-escuro transition-colors shrink-0">
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
        ) : erroCarga ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <p className="text-sm text-tinta-2">Não foi possível carregar os trabalhos. Tente de novo.</p>
            <button onClick={tentarDeNovo}
              className="px-4 py-2 bg-petroleo text-white rounded-lg text-sm font-medium hover:bg-petroleo-escuro transition-colors">
              Tentar de novo
            </button>
          </div>
        ) : (
          <div className="flex gap-4 min-w-max xl:min-w-0 h-full">
            {ETAPAS.map((col) => {
              const colItems = filtrados.filter((i) => i.status === col.id)
              return (
                <div key={col.id} className="w-72 xl:w-auto xl:flex-1 xl:min-w-0 flex flex-col">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: col.cor }} />
                    <span className="text-sm font-semibold text-tinta">{col.rotulo}</span>
                    <span className="ml-auto bg-porcelana text-tinta-3 text-xs font-medium rounded-full w-6 h-6 flex items-center justify-center">
                      {colItems.length}
                    </span>
                  </div>

                  <div className="flex-1 bg-porcelana-2 rounded-xl p-3 space-y-3 min-h-[200px]">
                    {colItems.length === 0 ? (
                      <div className="flex items-center justify-center h-24 text-xs text-tinta-4">
                        Nenhum trabalho
                      </div>
                    ) : (
                      colItems.map((item) => (
                        <CartaoProtese
                          key={item.id}
                          protese={item}
                          hojeYmd={hojeYmd}
                          ocupado={ocupado === item.id}
                          onAbrir={() => setModal({ protese: item })}
                          onMover={(para) => { setOcupado(item.id); setMover({ protese: item, para }) }}
                        />
                      ))
                    )}
                    {col.id === 'installed' && (
                      <button type="button" onClick={() => setTodas((t) => !t)}
                        className="w-full text-xs text-petroleo font-medium hover:underline py-1">
                        {todas ? 'Só últimos 30 dias' : 'Ver todas'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {modal && (
        <ModalProtese
          protese={modal.protese}
          onClose={() => setModal(null)}
          onSaved={(msg) => {
            setModal(null)
            if (msg) mostrarAviso(msg)
            recarregar()
          }}
        />
      )}

      {mover && (
        <DialogMover
          protese={mover.protese}
          para={mover.para}
          hojeYmd={hojeYmd}
          onClose={() => { setMover(null); setOcupado(null) }}
          onMoved={(r) => {
            setMover(null)
            if (r.expense) mostrarAviso(`Despesa de ${formatValor(Number(r.expense.amount))} lançada no Financeiro (a pagar)`)
            recarregar()
          }}
          onConflito={() => {
            setMover(null)
            mostrarAviso('Este trabalho foi atualizado por outra pessoa')
            recarregar()
          }}
        />
      )}
    </div>
  )
}
