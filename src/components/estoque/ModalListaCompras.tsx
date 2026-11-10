'use client'

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { InventoryItem } from '@/types'
import { useClinicStore } from '@/store/clinicStore'
import { listaDeCompras, textoListaCompras, type GrupoCompra } from '@/lib/estoque/compras'
import { dataBr } from '@/lib/estoque/formatar'
import { btnPriCls, btnSecCls } from './ModalBase'

interface Props {
  itens: InventoryItem[]
  hojeYmd: string
  onClose: () => void
}

/**
 * Renderizada em portal no <body>: o layout do painel tem `print:hidden`, então
 * ao imprimir só esta janela aparece (sem fundo, barra lateral ou botões).
 */
export function ModalListaCompras({ itens, hojeYmd, onClose }: Props) {
  const clinicName = useClinicStore((s) => s.clinicName)
  const clinica = clinicName || 'Clínica'
  const sugeridos = useMemo(() => listaDeCompras(itens), [itens])
  const [edit, setEdit] = useState<Record<string, string>>({})
  const [copiado, setCopiado] = useState(false)
  const [erro, setErro] = useState('')

  // Texto digitado inválido (vazio, decimal, negativo) volta à sugestão.
  const qtdDe = (id: string, sugerida: number): number => {
    const v = edit[id]
    if (v === undefined) return sugerida
    const n = Number(v)
    return v !== '' && Number.isInteger(n) && n >= 0 ? n : sugerida
  }

  const grupos: GrupoCompra[] = sugeridos
    .map((g) => ({
      ...g,
      itens: g.itens.map((i) => ({ ...i, quantidade: qtdDe(i.id, i.quantidade) })).filter((i) => i.quantidade > 0),
    }))
    .filter((g) => g.itens.length > 0)

  async function copiar() {
    setErro('')
    try {
      await navigator.clipboard.writeText(textoListaCompras(grupos, clinica, hojeYmd))
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      setErro('Não foi possível copiar o texto.')
    }
  }

  const modal = (
    <div className="fixed inset-0 z-50 flex items-center justify-center print:static print:block">
      <div className="absolute inset-0 bg-black/50 print:hidden" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[92vh] overflow-y-auto print:max-h-none print:max-w-none print:mx-0 print:shadow-none print:rounded-none print:overflow-visible">
        <div className="flex items-center justify-between p-5 border-b border-linha">
          <div>
            <h2 className="text-base font-semibold text-tinta">Lista de compras</h2>
            <p className="text-xs text-tinta-3">{clinica}{hojeYmd ? ` — ${dataBr(hojeYmd)}` : ''}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded text-tinta-4 hover:text-tinta-2 print:hidden" aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {erro && <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 print:hidden">{erro}</div>}
          {sugeridos.length === 0 ? (
            <p className="text-sm text-tinta-3 text-center py-6">Nada abaixo do mínimo.</p>
          ) : (
            sugeridos.map((g) => (
              <section key={g.fornecedor}>
                <h3 className="text-sm font-semibold text-tinta mb-2">{g.fornecedor}</h3>
                <ul className="divide-y divide-linha">
                  {g.itens.map((i) => {
                    const q = qtdDe(i.id, i.quantidade)
                    return (
                      <li key={i.id} className={`flex items-center justify-between gap-3 py-2 text-sm ${q === 0 ? 'text-tinta-4 print:hidden' : 'text-tinta'}`}>
                        <span className={q === 0 ? 'line-through' : ''}>{i.nome}</span>
                        <span className="flex items-center gap-2 shrink-0">
                          <input
                            type="number" min={0} step={1} inputMode="numeric" aria-label={`Quantidade de ${i.nome}`}
                            value={edit[i.id] ?? String(i.quantidade)}
                            onChange={(e) => setEdit((p) => ({ ...p, [i.id]: e.target.value }))}
                            className="w-20 h-9 px-2 rounded-lg border border-linha text-sm text-right bg-white focus:outline-none focus:ring-2 focus:ring-petroleo print:hidden"
                          />
                          <span className="hidden print:inline">{q}</span>
                          {i.unidade && <span className="text-tinta-3">{i.unidade}</span>}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))
          )}
          {sugeridos.length > 0 && grupos.length === 0 && (
            <p className="text-sm text-tinta-3 text-center">Todos os itens foram zerados.</p>
          )}
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-linha print:hidden">
          <button onClick={onClose} className={btnSecCls}>Fechar</button>
          {grupos.length > 0 && (
            <>
              <button onClick={() => window.print()} className={btnSecCls}>Imprimir</button>
              <button onClick={() => void copiar()} className={btnPriCls}>{copiado ? 'Copiado' : 'Copiar texto'}</button>
            </>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
