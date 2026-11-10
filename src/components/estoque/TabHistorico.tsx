'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { InventoryItem, InventoryMovement } from '@/types'
import { KIND_LABEL } from '@/lib/estoque/rotulos'
import { RotuloTratamento } from './RotuloTratamento'
import { rotuloTratamento } from '@/lib/kits/baixa'
import { rotuloLote, trintaDiasAntes } from '@/lib/estoque/formatar'

interface Props {
  itens: InventoryItem[]
  hojeYmd: string
}

const filtroCls = 'h-10 px-3 rounded-lg border border-linha text-sm bg-white focus:outline-none focus:ring-2 focus:ring-petroleo'

function motivo(m: InventoryMovement): string {
  return m.kind ? KIND_LABEL[m.kind] : (m.reason ?? '')
}

function dataHora(iso: string): string {
  const s = new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  return s.replace(',', '')
}

function Tipo({ tipo }: { tipo: 'in' | 'out' }) {
  return tipo === 'in'
    ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700">Entrada</span>
    : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700">Saída</span>
}

export function TabHistorico({ itens, hojeYmd }: Props) {
  // null = ainda no padrão (últimos 30 dias até hoje).
  const [deSel, setDeSel] = useState<string | null>(null)
  const [ateSel, setAteSel] = useState<string | null>(null)
  const [produto, setProduto] = useState('')
  const [tipo, setTipo] = useState<'' | 'in' | 'out'>('')
  const [movs, setMovs] = useState<InventoryMovement[] | null>(null)
  const [erro, setErro] = useState('')
  const [versao, setVersao] = useState(0)

  const de = deSel || (hojeYmd ? trintaDiasAntes(hojeYmd) : '')
  const ate = ateSel || hojeYmd

  useEffect(() => {
    if (!de || !ate) return
    let cancelado = false
    const qs = new URLSearchParams({ de, ate })
    if (produto) qs.set('produto', produto)
    if (tipo) qs.set('tipo', tipo)
    fetch(`/api/estoque/movimentos?${qs}`)
      .then(async (res) => {
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(j.error ?? 'Não foi possível carregar o histórico.')
        return j
      })
      .then((j) => { if (!cancelado) { setMovs(j.itens ?? []); setErro('') } })
      .catch((e: Error) => { if (!cancelado) { setMovs([]); setErro(e.message || 'Não foi possível carregar o histórico.') } })
    return () => { cancelado = true }
  }, [de, ate, produto, tipo, versao])

  function mudar(fn: () => void) {
    fn()
    setMovs(null)
    setErro('')
  }

  const nomeProduto = (m: InventoryMovement) => m.item?.name ?? '—'
  const qtd = (m: InventoryMovement) => `${m.quantity}${m.item?.unit ? ` ${m.item.unit}` : ''}`
  const lote = (m: InventoryMovement) => (m.lot ? rotuloLote(m.lot) : '—')
  const despesa = (m: InventoryMovement) =>
    m.expense_id ? <Link href="/financeiro" className="ml-2 text-petroleo hover:underline">Despesa</Link> : null

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-tinta-3">De
          <input type="date" className={`${filtroCls} block mt-1`} value={de} max={ate || undefined}
            onChange={(e) => mudar(() => setDeSel(e.target.value))} />
        </label>
        <label className="text-xs text-tinta-3">Até
          <input type="date" className={`${filtroCls} block mt-1`} value={ate} min={de || undefined}
            onChange={(e) => mudar(() => setAteSel(e.target.value))} />
        </label>
        <select className={filtroCls} value={produto} aria-label="Produto" onChange={(e) => mudar(() => setProduto(e.target.value))}>
          <option value="">Todos os produtos</option>
          {itens.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <select className={filtroCls} value={tipo} aria-label="Tipo" onChange={(e) => mudar(() => setTipo(e.target.value as '' | 'in' | 'out'))}>
          <option value="">Entradas e saídas</option>
          <option value="in">Entradas</option>
          <option value="out">Saídas</option>
        </select>
      </div>

      {erro ? (
        <div className="flex flex-col items-center justify-center h-48 gap-3">
          <p className="text-sm text-tinta-3">{erro}</p>
          <button onClick={() => mudar(() => setVersao((v) => v + 1))} className="px-4 py-2 rounded-lg border border-linha text-sm text-tinta hover:bg-porcelana-2">Tentar de novo</button>
        </div>
      ) : movs === null ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-6 h-6 border-2 border-petroleo border-t-transparent rounded-full animate-spin" />
        </div>
      ) : movs.length === 0 ? (
        <p className="text-sm text-tinta-3 text-center py-12">Nenhuma movimentação no período.</p>
      ) : (
        <>
          {movs.length >= 500 && <p className="text-xs text-tinta-3">Mostrando as 500 mais recentes — reduza o período.</p>}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-linha bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-tinta-3 border-b border-linha">
                  <th className="px-4 py-3 font-medium">Data</th>
                  <th className="px-4 py-3 font-medium">Produto</th>
                  <th className="px-4 py-3 font-medium">Tipo</th>
                  <th className="px-4 py-3 font-medium">Quantidade</th>
                  <th className="px-4 py-3 font-medium">Lote</th>
                  <th className="px-4 py-3 font-medium">Motivo</th>
                  <th className="px-4 py-3 font-medium">Observação</th>
                </tr>
              </thead>
              <tbody>
                {movs.map((m) => (
                  <tr key={m.id} className="border-b border-linha last:border-0 text-tinta">
                    <td className="px-4 py-3 whitespace-nowrap">{dataHora(m.created_at)}</td>
                    <td className="px-4 py-3">{nomeProduto(m)}</td>
                    <td className="px-4 py-3"><Tipo tipo={m.type} /></td>
                    <td className="px-4 py-3 whitespace-nowrap">{qtd(m)}</td>
                    <td className="px-4 py-3">{lote(m)}</td>
                    <td className="px-4 py-3">{motivo(m)}{despesa(m)}</td>
                    <td className="px-4 py-3 text-tinta-3">{rotuloTratamento(m) ? <RotuloTratamento m={m} /> : (m.notes || '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="md:hidden space-y-3">
            {movs.map((m) => (
              <li key={m.id} className="rounded-xl border border-linha bg-white p-4 text-sm text-tinta">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{nomeProduto(m)}</span>
                  <Tipo tipo={m.type} />
                </div>
                <p className="mt-1 text-xs text-tinta-3">{dataHora(m.created_at)}</p>
                <p className="mt-2">{qtd(m)} · {lote(m)}</p>
                <p className="mt-1">{motivo(m)}{despesa(m)}</p>
                {rotuloTratamento(m)
                  ? <p className="mt-1 text-tinta-3"><RotuloTratamento m={m} /></p>
                  : m.notes && <p className="mt-1 text-tinta-3">{m.notes}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
