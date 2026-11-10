'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search, ShoppingCart } from 'lucide-react'
import { useClinicStore } from '@/store/clinicStore'
import type { InventoryItem } from '@/types'
import { alertasDoItem, resumoAlertas } from '@/lib/estoque/alertas'
import { AvisosEstoque, type FiltroAviso } from '@/components/estoque/AvisosEstoque'
import { TabelaProdutos, type AcaoProduto } from '@/components/estoque/TabelaProdutos'
import { ModalProduto } from '@/components/estoque/ModalProduto'

type Tab = 'produtos' | 'historico'

export type Janela =
  | { tipo: 'produto'; item?: InventoryItem }
  | { tipo: 'entrada' | 'saida' | 'contagem' | 'detalhes'; item: InventoryItem }
  | { tipo: 'compras' }
  | null

const filtroCls = 'h-10 px-3 rounded-lg border border-linha text-sm bg-white focus:outline-none focus:ring-2 focus:ring-petroleo'

export default function EstoquePage() {
  const { clinicId, loading: clinicLoading } = useClinicStore()
  const [activeTab, setActiveTab] = useState<Tab>('produtos')
  const [itens, setItens] = useState<InventoryItem[]>([])
  const [hoje, setHoje] = useState('')
  const [loading, setLoading] = useState(true)
  const [erroCarga, setErroCarga] = useState(false)
  const [versao, setVersao] = useState(0)
  const [janela, setJanela] = useState<Janela>(null)
  const [aviso, setAviso] = useState('')
  const [erroAcao, setErroAcao] = useState('')
  const avisoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState('')
  const [soAlerta, setSoAlerta] = useState(false)
  const [inativos, setInativos] = useState(false)
  const [filtroAviso, setFiltroAviso] = useState<FiltroAviso>(null)

  useEffect(() => {
    if (!clinicId) return
    let cancelado = false
    fetch(`/api/estoque${inativos ? '?inativos=1' : ''}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('falha')
        return res.json()
      })
      .then((j) => {
        if (cancelado) return
        setItens(j.itens ?? [])
        setHoje(j.hoje ?? '')
        setErroCarga(false)
        setLoading(false)
      })
      .catch(() => {
        if (cancelado) return
        setErroCarga(true)
        setLoading(false)
      })
    return () => { cancelado = true }
  }, [clinicId, inativos, versao])

  function recarregar() { setVersao((v) => v + 1) }

  function tentarDeNovo() {
    setLoading(true)
    setErroCarga(false)
    recarregar()
  }

  function mostrarAviso(msg: string) {
    setAviso(msg)
    if (avisoTimer.current) clearTimeout(avisoTimer.current)
    avisoTimer.current = setTimeout(() => setAviso(''), 4000)
  }

  useEffect(() => () => { if (avisoTimer.current) clearTimeout(avisoTimer.current) }, [])

  async function alternarAtivo(item: InventoryItem) {
    if (item.active && item.quantity > 0 && !window.confirm(`Ainda há ${item.quantity} ${item.unit ?? ''} em estoque. Desativar mesmo assim?`.replace(/\s+/g, ' '))) return
    setErroAcao('')
    try {
      const res = await fetch(`/api/estoque/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: item.name,
          category: item.category ?? null,
          unit: item.unit ?? null,
          minQuantity: item.min_quantity,
          idealQuantity: item.ideal_quantity ?? null,
          supplier: item.supplier ?? null,
          trackExpiry: item.tracks_expiry,
          active: !item.active,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErroAcao(json.error ?? 'Não foi possível salvar. Tente novamente.'); return }
      mostrarAviso(item.active ? 'Produto desativado' : 'Produto reativado')
      recarregar()
    } catch {
      setErroAcao('Não foi possível concluir. Verifique a conexão e tente novamente.')
    }
  }

  function acao(tipo: AcaoProduto, item: InventoryItem) {
    if (tipo === 'editar') setJanela({ tipo: 'produto', item })
    else if (tipo === 'ativar') void alternarAtivo(item)
    else setJanela({ tipo, item })
  }

  const resumo = useMemo(() => resumoAlertas(itens, hoje), [itens, hoje])
  // Filtro de aviso só vale enquanto o chip correspondente existe (contagem > 0).
  const filtroEfetivo: FiltroAviso = filtroAviso && resumo[filtroAviso] > 0 ? filtroAviso : null
  const categorias = useMemo(
    () => [...new Set(itens.map((i) => i.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [itens],
  )
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return itens.filter((i) => {
      if (q && !i.name.toLowerCase().includes(q)) return false
      if (categoria && i.category !== categoria) return false
      const a = i.active ? alertasDoItem(i, hoje) : { baixo: false, vencidos: 0, vencendo: 0 }
      if (soAlerta && !(a.baixo || a.vencidos > 0 || a.vencendo > 0)) return false
      if (filtroEfetivo === 'baixo' && !a.baixo) return false
      if (filtroEfetivo === 'vencidos' && a.vencidos === 0) return false
      if (filtroEfetivo === 'vencendo' && a.vencendo === 0) return false
      return true
    })
  }, [itens, hoje, busca, categoria, soAlerta, filtroEfetivo])

  if (clinicLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)]">
        <div className="w-8 h-8 border-2 border-petroleo border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const btnSec = 'flex items-center gap-2 px-3 sm:px-4 py-2 border border-linha bg-white text-tinta rounded-lg text-sm font-medium hover:bg-porcelana-2 transition-colors shrink-0'

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col">
      {aviso && (
        <div role="status" className="mx-4 sm:mx-6 mt-3 px-4 py-2 rounded-lg bg-gengiva-50 text-gengiva-escuro text-sm font-medium">
          {aviso}
        </div>
      )}
      <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl sm:text-[26px] font-semibold text-tinta leading-tight">Estoque</h1>
        {activeTab === 'produtos' && (
          <div className="flex items-center gap-2">
            <button onClick={() => setJanela({ tipo: 'compras' })} className={btnSec}>
              <ShoppingCart className="w-4 h-4" />
              Lista de compras
            </button>
            <button onClick={() => setJanela({ tipo: 'produto' })}
              className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-petroleo text-white rounded-lg text-sm font-medium hover:bg-petroleo-escuro transition-colors shrink-0">
              <Plus className="w-4 h-4" />
              Novo produto
            </button>
          </div>
        )}
      </div>

      <div className="border-b border-linha px-2 sm:px-6">
        <div className="flex">
          {(['produtos', 'historico'] as Tab[]).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab ? 'border-petroleo text-petroleo' : 'border-transparent text-tinta-3 hover:text-tinta'
              }`}>
              {tab === 'historico' ? 'Histórico' : 'Produtos'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-6">
        {activeTab === 'produtos' && (
          <>
            {erroAcao && <div role="alert" className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{erroAcao}</div>}

            {!loading && !erroCarga && <AvisosEstoque resumo={resumo} filtro={filtroEfetivo} onFiltro={setFiltroAviso} />}

            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[180px] sm:max-w-xs">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-tinta-4" />
                <input className={`${filtroCls} w-full pl-9`} placeholder="Buscar produto" value={busca} onChange={(e) => setBusca(e.target.value)} />
              </div>
              <select className={filtroCls} value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoria">
                <option value="">Todas as categorias</option>
                {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <label className="flex items-center gap-2 text-sm text-tinta">
                <input type="checkbox" checked={soAlerta} onChange={(e) => setSoAlerta(e.target.checked)} className="w-4 h-4 accent-petroleo" />
                Só com alerta
              </label>
              <label className="flex items-center gap-2 text-sm text-tinta">
                <input type="checkbox" checked={inativos} onChange={(e) => { setInativos(e.target.checked); setLoading(true) }} className="w-4 h-4 accent-petroleo" />
                Mostrar inativos
              </label>
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-48">
                <div className="w-6 h-6 border-2 border-petroleo border-t-transparent rounded-full animate-spin" />
              </div>
            ) : erroCarga ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <p className="text-sm text-tinta-3">Não foi possível carregar o estoque.</p>
                <button onClick={tentarDeNovo} className="px-4 py-2 rounded-lg border border-linha text-sm text-tinta hover:bg-porcelana-2">Tentar de novo</button>
              </div>
            ) : itens.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <p className="text-sm text-tinta-3 text-center">Nenhum produto cadastrado. Cadastre o primeiro para controlar o estoque.</p>
              </div>
            ) : visiveis.length === 0 ? (
              <p className="text-sm text-tinta-3 text-center py-12">Nenhum produto encontrado com esses filtros.</p>
            ) : (
              <TabelaProdutos itens={visiveis} hojeYmd={hoje} onAcao={acao} />
            )}
          </>
        )}

        {activeTab === 'historico' && (
          <div className="flex items-center justify-center h-48 text-tinta-4 text-sm">
            Histórico de movimentação em desenvolvimento...
          </div>
        )}
      </div>

      {janela?.tipo === 'produto' && (
        <ModalProduto
          item={janela.item}
          categorias={categorias}
          onClose={() => setJanela(null)}
          onSaved={(msg) => { setJanela(null); if (msg) mostrarAviso(msg); recarregar() }}
        />
      )}
      {/* Entrada, saída, contagem, detalhes e lista de compras: renderizados nas Tasks 5 e 6. */}
    </div>
  )
}
