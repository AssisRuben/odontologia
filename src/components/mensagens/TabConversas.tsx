'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { Conversation } from '@/types'
import ConversaPainel from './ConversaPainel'

type Filtro = 'aguardando' | 'agente' | 'todas'
type Item = Conversation & { label: string; ultima: string | null }

const FILTROS: { id: Filtro; label: string }[] = [
  { id: 'aguardando', label: 'Aguardando recepção' },
  { id: 'agente', label: 'Com o agente' },
  { id: 'todas', label: 'Todas' },
]
const PAGE = 30

export default function TabConversas() {
  const [filtro, setFiltro] = useState<Filtro>('aguardando')
  const [items, setItems] = useState<Item[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const fetchPage = useCallback(async (antes?: string): Promise<Item[] | null> => {
    const qs = new URLSearchParams({ filtro })
    if (antes) qs.set('antes', antes)
    try {
      const res = await fetch(`/api/conversas?${qs}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error ?? 'Não foi possível carregar as conversas.'); return null }
      setError(null)
      return json.conversas as Item[]
    } catch {
      setError('Não foi possível carregar as conversas.')
      return null
    }
  }, [filtro])

  // Recarrega a primeira página e mantém as páginas mais antigas já carregadas.
  const refresh = useCallback(async () => {
    const first = await fetchPage()
    if (!first) { setLoading(false); return }
    setItems((prev) => {
      if (first.length < PAGE) return first
      const ids = new Set(first.map((c) => c.id))
      const oldest = first[first.length - 1].last_message_at
      return [...first, ...prev.filter((c) => !ids.has(c.id) && c.last_message_at < oldest)]
    })
    setHasMore(first.length >= PAGE)
    setLoading(false)
  }, [fetchPage])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setItems([])
    refresh()
    const t = setInterval(() => { if (document.visibilityState === 'visible') refresh() }, 10_000)
    return () => clearInterval(t)
  }, [refresh])

  async function loadMore() {
    const last = items[items.length - 1]
    if (!last) return
    const more = await fetchPage(last.last_message_at)
    if (!more) return
    setItems((prev) => [...prev, ...more.filter((c) => !prev.some((p) => p.id === c.id))])
    setHasMore(more.length === PAGE)
  }

  function select(id: string) {
    setSelected(id)
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, unread: false } : c)))
    window.dispatchEvent(new Event('conversas:seen'))
  }

  return (
    <div className="h-full bg-white rounded-xl border border-linha flex overflow-hidden">
      <div className={`${selected ? 'hidden sm:flex' : 'flex'} flex-col w-full sm:w-80 sm:border-r border-linha shrink-0 min-h-0`}>
        <div className="p-2 border-b border-linha flex gap-1 flex-wrap">
          {FILTROS.map((f) => (
            <button key={f.id} onClick={() => setFiltro(f.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg ${filtro === f.id ? 'bg-petroleo-50 text-petroleo' : 'text-tinta-3 hover:bg-porcelana'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {error && <p className="p-4 text-sm text-[#EF4444]">{error}</p>}
          {loading && !error && <p className="p-4 text-sm text-tinta-3">Carregando…</p>}
          {!loading && !error && items.length === 0 && <p className="p-4 text-sm text-tinta-3">Nenhuma conversa.</p>}
          {items.map((c) => (
            <button key={c.id} onClick={() => select(c.id)}
              className={`w-full text-left px-4 py-3 border-b border-linha hover:bg-porcelana-2 ${selected === c.id ? 'bg-petroleo-50' : ''}`}>
              <div className="flex items-center gap-2">
                {c.unread && <span className="w-2 h-2 rounded-full bg-petroleo shrink-0" aria-label="Não lida" />}
                <span className="text-sm font-medium text-tinta truncate flex-1">{c.label}</span>
                <span className="text-[10px] text-tinta-3 shrink-0">
                  {formatDistanceToNow(new Date(c.last_message_at), { locale: ptBR, addSuffix: true })}
                </span>
              </div>
              {c.ultima && <p className="text-xs text-tinta-3 truncate mt-0.5">{c.ultima}</p>}
            </button>
          ))}
          {hasMore && (
            <button onClick={loadMore} className="w-full py-3 text-sm text-petroleo hover:bg-porcelana-2">Carregar mais</button>
          )}
        </div>
      </div>

      {selected ? (
        <div className="flex-1 flex min-w-0 min-h-0">
          <ConversaPainel key={selected} id={selected} onBack={() => setSelected(null)} onChanged={refresh} />
        </div>
      ) : (
        <div className="hidden sm:flex flex-1 items-center justify-center text-sm text-tinta-3">Selecione uma conversa</div>
      )}
    </div>
  )
}
