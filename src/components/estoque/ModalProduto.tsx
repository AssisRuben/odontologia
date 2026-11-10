'use client'

import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { InventoryItem } from '@/types'

const inputCls = 'w-full h-10 px-3 rounded-lg border border-linha text-sm bg-white focus:outline-none focus:ring-2 focus:ring-petroleo'
const labelCls = 'block text-sm font-medium text-tinta mb-1'

interface Props {
  item?: InventoryItem
  categorias: string[]
  onClose: () => void
  onSaved: (msg?: string) => void
}

/** Texto de número inteiro >= 0: '' vira null; inválido vira undefined. */
function inteiro(s: string): number | null | undefined {
  const t = s.trim()
  if (t === '') return null
  return /^\d+$/.test(t) ? Number(t) : undefined
}

export function ModalProduto({ item, categorias, onClose, onSaved }: Props) {
  const [nome, setNome] = useState(item?.name ?? '')
  const [categoria, setCategoria] = useState(item?.category ?? '')
  const [unidade, setUnidade] = useState(item?.unit ?? '')
  const [minimo, setMinimo] = useState(item ? String(item.min_quantity) : '0')
  const [ideal, setIdeal] = useState(item?.ideal_quantity != null ? String(item.ideal_quantity) : '')
  const [fornecedor, setFornecedor] = useState(item?.supplier ?? '')
  const [validade, setValidade] = useState(item?.tracks_expiry ?? false)
  const [saldo, setSaldo] = useState('')
  const [lote, setLote] = useState('')
  const [venceEm, setVenceEm] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const emAndamento = useRef(false)

  const minimoN = inteiro(minimo)
  const idealN = inteiro(ideal)
  const saldoN = inteiro(saldo)
  const numerosOk = minimoN !== undefined && idealN !== undefined && saldoN !== undefined
  const podeSalvar = nome.trim() !== '' && numerosOk && !enviando

  async function salvar() {
    if (!podeSalvar || emAndamento.current) return
    if (item?.tracks_expiry && !validade && (item.lots?.length ?? 0) > 0 &&
        !window.confirm('Os lotes e validades deste produto serão apagados. Continuar?')) return
    emAndamento.current = true
    setEnviando(true)
    setErro('')
    try {
      const body: Record<string, unknown> = {
        name: nome.trim(),
        category: categoria.trim() || null,
        unit: unidade.trim() || null,
        minQuantity: minimoN ?? 0,
        idealQuantity: idealN ?? null,
        supplier: fornecedor.trim() || null,
        trackExpiry: validade,
      }
      if (item) {
        body.active = item.active
      } else {
        if (saldoN != null) body.initialQuantity = saldoN
        if (validade) {
          body.lotCode = lote.trim() || null
          body.expiresAt = venceEm || null
        }
      }
      const res = await fetch(item ? `/api/estoque/${item.id}` : '/api/estoque', {
        method: item ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(json.error ?? 'Não foi possível salvar. Tente novamente.'); return }
      onSaved(item ? 'Produto atualizado' : 'Produto cadastrado')
    } catch {
      setErro('Não foi possível concluir. Verifique a conexão e tente novamente.')
    } finally {
      emAndamento.current = false
      setEnviando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={enviando ? undefined : onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-linha">
          <h2 className="text-base font-semibold text-tinta">{item ? 'Editar produto' : 'Novo produto'}</h2>
          <button onClick={onClose} className="p-1 rounded text-tinta-4 hover:text-tinta-2" aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {erro && <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{erro}</div>}

          <div>
            <label htmlFor="prod-nome" className={labelCls}>Nome *</label>
            <input id="prod-nome" className={inputCls} value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="prod-categoria" className={labelCls}>Categoria</label>
              <input id="prod-categoria" className={inputCls} list="estoque-categorias" value={categoria} maxLength={40} onChange={(e) => setCategoria(e.target.value)} />
              <datalist id="estoque-categorias">
                {categorias.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <label htmlFor="prod-unidade" className={labelCls}>Unidade</label>
              <input id="prod-unidade" className={inputCls} placeholder="un, cx, ml..." value={unidade} maxLength={40} onChange={(e) => setUnidade(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="prod-minimo" className={labelCls}>Estoque mínimo</label>
              <input id="prod-minimo" className={inputCls} inputMode="numeric" value={minimo} onChange={(e) => setMinimo(e.target.value)} />
            </div>
            <div>
              <label htmlFor="prod-ideal" className={labelCls}>Estoque ideal</label>
              <input id="prod-ideal" className={inputCls} inputMode="numeric" placeholder="opcional" value={ideal} onChange={(e) => setIdeal(e.target.value)} />
            </div>
          </div>
          {!numerosOk && <p className="text-xs text-red-600 -mt-2">Use apenas números inteiros.</p>}

          <div>
            <label htmlFor="prod-fornecedor" className={labelCls}>Fornecedor</label>
            <input id="prod-fornecedor" className={inputCls} value={fornecedor} maxLength={80} onChange={(e) => setFornecedor(e.target.value)} />
          </div>

          <label className="flex items-center gap-2 text-sm text-tinta">
            <input type="checkbox" checked={validade} onChange={(e) => setValidade(e.target.checked)} className="w-4 h-4 accent-petroleo" />
            Controlar validade
          </label>

          {!item && (
            <div className="rounded-lg border border-linha p-3 space-y-3">
              <div>
                <label htmlFor="prod-saldo" className={labelCls}>Saldo inicial</label>
                <input id="prod-saldo" className={inputCls} inputMode="numeric" placeholder="0" value={saldo} onChange={(e) => setSaldo(e.target.value)} />
              </div>
              {validade && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="prod-lote" className={labelCls}>Lote</label>
                    <input id="prod-lote" className={inputCls} placeholder="opcional" value={lote} maxLength={40} onChange={(e) => setLote(e.target.value)} />
                  </div>
                  <div>
                    <label htmlFor="prod-validade-lote" className={labelCls}>Validade</label>
                    <input id="prod-validade-lote" type="date" className={inputCls} value={venceEm} onChange={(e) => setVenceEm(e.target.value)} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-linha">
          <button onClick={onClose} disabled={enviando} className="px-4 py-2 rounded-lg border border-linha text-sm text-tinta hover:bg-porcelana-2 disabled:opacity-50">Cancelar</button>
          <button onClick={salvar} disabled={!podeSalvar} className="px-4 py-2 rounded-lg bg-petroleo text-white text-sm font-medium hover:bg-petroleo-escuro disabled:opacity-50">
            {enviando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
