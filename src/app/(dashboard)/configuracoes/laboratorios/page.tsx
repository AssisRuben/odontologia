'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

type Laboratorio = {
  id: string
  name: string
  phone?: string | null
  notes?: string | null
  active: boolean
  emAndamento: number
}

type Rascunho = { name: string; phone: string; notes: string }

const inputCls =
  'w-full h-10 px-3 rounded-lg border border-linha text-sm text-tinta focus:outline-none focus:ring-2 focus:ring-petroleo'
const btnPrimario =
  'h-10 px-5 rounded-lg bg-petroleo text-white text-sm font-medium hover:bg-petroleo-escuro transition-colors disabled:opacity-50'
const btnSecundario =
  'h-10 px-4 rounded-lg border border-linha text-sm font-medium text-tinta-2 hover:bg-porcelana transition-colors disabled:opacity-50'

async function lerErro(res: Response): Promise<string> {
  try {
    const j = await res.json()
    if (j && typeof j.error === 'string') return j.error
  } catch {}
  return 'Não foi possível concluir a operação. Tente novamente.'
}

export default function LaboratoriosPage() {
  const [itens, setItens] = useState<Laboratorio[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [novo, setNovo] = useState<Rascunho>({ name: '', phone: '', notes: '' })
  const [editId, setEditId] = useState<string | null>(null)
  const [edit, setEdit] = useState<Rascunho>({ name: '', phone: '', notes: '' })

  const carregar = useCallback(async () => {
    try {
      const res = await fetch('/api/laboratorios')
      if (!res.ok) { setError(await lerErro(res)); return }
      const j = await res.json()
      setItens(j.itens ?? [])
    } catch {
      setError('Não foi possível carregar os laboratórios.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetch('/api/laboratorios')
      .then(async (res) => {
        if (!res.ok) { setError(await lerErro(res)); return }
        const j = await res.json()
        setItens(j.itens ?? [])
      })
      .catch(() => setError('Não foi possível carregar os laboratórios.'))
      .finally(() => setLoading(false))
  }, [])

  async function enviar(url: string, method: 'POST' | 'PATCH', body: object): Promise<boolean> {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) { setError(await lerErro(res)); return false }
      await carregar()
      return true
    } catch {
      setError('Não foi possível concluir a operação. Tente novamente.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function adicionar(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    const name = novo.name.trim()
    if (!name) { setError('Informe o nome do laboratório.'); return }
    const ok = await enviar('/api/laboratorios', 'POST', {
      name,
      phone: novo.phone.trim() || undefined,
      notes: novo.notes.trim() || undefined,
    })
    if (ok) setNovo({ name: '', phone: '', notes: '' })
  }

  function abrirEdicao(l: Laboratorio) {
    setError('')
    setEditId(l.id)
    setEdit({ name: l.name, phone: l.phone ?? '', notes: l.notes ?? '' })
  }

  async function salvarEdicao(e: React.FormEvent) {
    e.preventDefault()
    if (busy || !editId) return
    const name = edit.name.trim()
    if (!name) { setError('Informe o nome do laboratório.'); return }
    const ok = await enviar(`/api/laboratorios/${editId}`, 'PATCH', {
      name,
      phone: edit.phone.trim() || null,
      notes: edit.notes.trim() || null,
    })
    if (ok) setEditId(null)
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-start gap-3 mb-6">
        <Link href="/configuracoes" className="mt-0.5 p-1.5 rounded-lg hover:bg-porcelana text-tinta-3" aria-label="Voltar para Configurações">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl sm:text-[26px] font-semibold text-tinta leading-tight">Laboratórios de prótese</h1>
          <p className="text-sm text-tinta-3">Laboratórios usados nos trabalhos de prótese.</p>
        </div>
      </div>

      <div className="space-y-4">
        <form onSubmit={adicionar} className="bg-white rounded-xl ring-1 ring-linha p-5 space-y-3">
          <h2 className="text-sm font-semibold text-tinta">Adicionar laboratório</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input aria-label="Nome do laboratório" placeholder="Nome" value={novo.name}
              onChange={(e) => setNovo((n) => ({ ...n, name: e.target.value }))} className={inputCls} />
            <input aria-label="Telefone do laboratório" placeholder="Telefone (opcional)" inputMode="tel" value={novo.phone}
              onChange={(e) => setNovo((n) => ({ ...n, phone: e.target.value }))} className={inputCls} />
          </div>
          <input aria-label="Observação do laboratório" placeholder="Observação (opcional)" value={novo.notes}
            onChange={(e) => setNovo((n) => ({ ...n, notes: e.target.value }))} className={inputCls} />
          <div className="flex justify-end">
            <button type="submit" disabled={busy} className={btnPrimario}>
              {busy && editId === null ? 'Salvando...' : 'Adicionar'}
            </button>
          </div>
        </form>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-7 h-7 border-2 border-petroleo border-t-transparent rounded-full animate-spin" />
          </div>
        ) : itens.length === 0 ? (
          <p className="text-sm text-tinta-3 bg-white rounded-xl ring-1 ring-linha px-5 py-6">
            Nenhum laboratório cadastrado. Adicione o primeiro para usar nos trabalhos de prótese.
          </p>
        ) : (
          <div className="bg-white rounded-xl ring-1 ring-linha divide-y divide-linha">
            {itens.map((l) =>
              editId === l.id ? (
                <form key={l.id} onSubmit={salvarEdicao} className="px-5 py-4 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input aria-label="Nome" value={edit.name}
                      onChange={(e) => setEdit((d) => ({ ...d, name: e.target.value }))} className={inputCls} />
                    <input aria-label="Telefone" inputMode="tel" value={edit.phone}
                      onChange={(e) => setEdit((d) => ({ ...d, phone: e.target.value }))} className={inputCls} />
                  </div>
                  <input aria-label="Observação" value={edit.notes}
                    onChange={(e) => setEdit((d) => ({ ...d, notes: e.target.value }))} className={inputCls} />
                  <div className="flex justify-end gap-2">
                    <button type="button" disabled={busy} onClick={() => { setEditId(null); setError('') }} className={btnSecundario}>
                      Cancelar
                    </button>
                    <button type="submit" disabled={busy} className={btnPrimario}>
                      {busy ? 'Salvando...' : 'Salvar'}
                    </button>
                  </div>
                </form>
              ) : (
                <div key={l.id} className="flex items-center gap-3 px-5 py-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-medium truncate ${l.active ? 'text-tinta' : 'text-tinta-3'}`}>{l.name}</p>
                      {!l.active && (
                        <span className="text-xs font-medium text-tinta-3 bg-porcelana rounded-full px-2 py-0.5">Inativo</span>
                      )}
                    </div>
                    <p className="text-xs text-tinta-3 mt-0.5">
                      {[l.phone, `${l.emAndamento} em andamento`].filter(Boolean).join(' · ')}
                    </p>
                    {l.notes && <p className="text-xs text-tinta-3 mt-0.5">{l.notes}</p>}
                  </div>
                  <button type="button" disabled={busy} onClick={() => abrirEdicao(l)} className={btnSecundario}>
                    Editar
                  </button>
                  <button type="button" disabled={busy} onClick={() => enviar(`/api/laboratorios/${l.id}`, 'PATCH', { active: !l.active })}
                    className={btnSecundario}>
                    {l.active ? 'Desativar' : 'Ativar'}
                  </button>
                </div>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  )
}
