'use client'

import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import type { InventoryItem } from '@/types'
import { alertasDoItem } from '@/lib/estoque/alertas'
import { diasParaVencer, proximaValidade, situacaoLote } from '@/lib/estoque/validade'

export type AcaoProduto = 'entrada' | 'saida' | 'contagem' | 'detalhes' | 'editar' | 'ativar'

interface Props {
  itens: InventoryItem[]
  hojeYmd: string
  onAcao: (tipo: AcaoProduto, item: InventoryItem) => void
}

const selo = 'inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap'

function fmtData(ymd: string) {
  const [y, m, d] = ymd.split('-')
  return `${d}/${m}/${y}`
}

function SeloValidade({ item, hojeYmd }: { item: InventoryItem; hojeYmd: string }) {
  const prox = item.tracks_expiry ? proximaValidade(item.lots ?? []) : null
  if (!prox) return <span className="text-tinta-4">—</span>
  const s = situacaoLote(prox, hojeYmd)
  const dias = diasParaVencer(prox, hojeYmd)
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="text-tinta-3">{fmtData(prox)}</span>
      {s === 'vencido' && <span className={`${selo} bg-red-100 text-red-600`}>Vencido</span>}
      {s === 'vence_em_breve' && (
        <span className={`${selo} bg-amber-100 text-amber-700`}>
          {dias === 0 ? 'Vence hoje' : `Vence em ${dias} ${dias === 1 ? 'dia' : 'dias'}`}
        </span>
      )}
    </span>
  )
}

function Situacao({ item, hojeYmd }: { item: InventoryItem; hojeYmd: string }) {
  if (!item.active) return <span className={`${selo} bg-porcelana-2 text-tinta-3`}>Inativo</span>
  const baixo = alertasDoItem(item, hojeYmd).baixo
  return <span className={`${selo} ${baixo ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700'}`}>{baixo ? 'Baixo' : 'OK'}</span>
}

function Menu({ item, onAcao }: { item: InventoryItem; onAcao: Props['onAcao'] }) {
  const [aberto, setAberto] = useState(false)
  const [pos, setPos] = useState({ top: 0, right: 0 })
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setAberto(false) }
    const fecha = () => setAberto(false)
    document.addEventListener('mousedown', fora)
    window.addEventListener('scroll', fecha, true)
    window.addEventListener('resize', fecha)
    return () => {
      document.removeEventListener('mousedown', fora)
      window.removeEventListener('scroll', fecha, true)
      window.removeEventListener('resize', fecha)
    }
  }, [aberto])
  const opcao = 'block w-full text-left px-3 py-2 text-sm text-tinta hover:bg-porcelana-2'
  const escolher = (t: AcaoProduto) => { setAberto(false); onAcao(t, item) }
  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-label="Mais ações" aria-expanded={aberto} onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
          setAberto((v) => !v)
        }}
        className="p-1.5 rounded-lg text-tinta-3 hover:bg-porcelana-2">
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {aberto && (
        <div style={{ top: pos.top, right: pos.right }} className="fixed z-30 w-40 bg-white border border-linha rounded-lg shadow-lg py-1">
          {item.active && <button className={opcao} onClick={() => escolher('contagem')}>Contagem</button>}
          <button className={opcao} onClick={() => escolher('editar')}>Editar</button>
          <button className={opcao} onClick={() => escolher('ativar')}>{item.active ? 'Desativar' : 'Reativar'}</button>
        </div>
      )}
    </div>
  )
}

function Botoes({ item, onAcao }: { item: InventoryItem; onAcao: Props['onAcao'] }) {
  const btn = 'px-2.5 py-1.5 rounded-lg border border-linha text-xs font-medium text-tinta hover:bg-porcelana-2'
  return (
    <div className="flex items-center justify-end gap-1.5">
      {item.active && <button className={btn} onClick={() => onAcao('entrada', item)}>Entrada</button>}
      {item.active && <button className={btn} onClick={() => onAcao('saida', item)}>Saída</button>}
      <Menu item={item} onAcao={onAcao} />
    </div>
  )
}

export function TabelaProdutos({ itens, hojeYmd, onAcao }: Props) {
  return (
    <>
      <div className="hidden sm:block bg-white rounded-xl border border-linha overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead>
            <tr className="border-b border-linha bg-porcelana-2 text-left text-tinta-3">
              <th className="px-4 py-3 font-medium">Produto</th>
              <th className="px-4 py-3 font-medium">Categoria</th>
              <th className="px-4 py-3 font-medium text-center">Qtd.</th>
              <th className="px-4 py-3 font-medium text-center">Mín.</th>
              <th className="px-4 py-3 font-medium">Próxima validade</th>
              <th className="px-4 py-3 font-medium text-center">Situação</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {itens.map((i) => (
              <tr key={i.id} className={`border-b border-linha last:border-0 hover:bg-porcelana-2 ${i.active ? '' : 'opacity-70'}`}>
                <td className="px-4 py-3">
                  <button className="font-medium text-tinta hover:text-petroleo text-left" onClick={() => onAcao('detalhes', i)}>{i.name}</button>
                </td>
                <td className="px-4 py-3 text-tinta-3">{i.category || '—'}</td>
                <td className={`px-4 py-3 text-center font-medium text-tinta`}>{i.quantity} {i.unit || ''}</td>
                <td className="px-4 py-3 text-center text-tinta-3">{i.min_quantity}</td>
                <td className="px-4 py-3"><SeloValidade item={i} hojeYmd={hojeYmd} /></td>
                <td className="px-4 py-3 text-center"><Situacao item={i} hojeYmd={hojeYmd} /></td>
                <td className="px-4 py-3"><Botoes item={i} onAcao={onAcao} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sm:hidden space-y-3">
        {itens.map((i) => (
          <div key={i.id} className={`bg-white rounded-xl border border-linha p-4 ${i.active ? '' : 'opacity-70'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <button className="font-medium text-tinta text-left" onClick={() => onAcao('detalhes', i)}>{i.name}</button>
                <p className="text-xs text-tinta-3">{i.category || 'Sem categoria'}</p>
              </div>
              <Situacao item={i} hojeYmd={hojeYmd} />
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className={`font-medium text-tinta`}>{i.quantity} {i.unit || ''} <span className="text-tinta-4 font-normal">(mín. {i.min_quantity})</span></span>
              <SeloValidade item={i} hojeYmd={hojeYmd} />
            </div>
            <div className="mt-3"><Botoes item={i} onAcao={onAcao} /></div>
          </div>
        ))}
      </div>
    </>
  )
}
