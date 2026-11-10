'use client'

import { useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { InventoryItem, Kit } from '@/types'
import { ModalBase, CaixaErro, inputCls, labelCls, btnSecCls, btnPriCls } from '@/components/estoque/ModalBase'

interface Props {
  kit: Kit | null
  produtos: InventoryItem[]
  onClose: () => void
  onSaved: () => void
}

interface Linha { key: number; itemId: string; quantidade: string }

let proxKey = 0
const novaKey = () => ++proxKey

export function ModalKit({ kit, produtos, onClose, onSaved }: Props) {
  const [nome, setNome] = useState(kit?.name ?? '')
  const [ativo, setAtivo] = useState(kit?.active ?? true)
  const [linhas, setLinhas] = useState<Linha[]>(() =>
    (kit?.items ?? []).map((ki) => ({ key: novaKey(), itemId: ki.item_id, quantidade: String(ki.quantity) })),
  )
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const emAndamento = useRef(false)

  const ids = linhas.map((l) => l.itemId)
  const qtdOk = (s: string) => /^\d+$/.test(s.trim()) && Number(s) >= 1 && Number(s) <= 9999
  const repetido = (id: string) => id !== '' && ids.filter((x) => x === id).length > 1
  const temRepetido = ids.some(repetido)
  const linhasOk = linhas.every((l) => l.itemId !== '' && qtdOk(l.quantidade))
  const podeSalvar = nome.trim() !== '' && linhasOk && !temRepetido && !enviando

  function opcoes(linha: Linha) {
    const lista = produtos.filter((p) => p.active || p.id === linha.itemId)
    if (linha.itemId && !lista.some((p) => p.id === linha.itemId)) {
      // Produto atual fora da lista da página (ex.: inativo não carregado): usa os dados do kit.
      const atual = kit?.items?.find((ki) => ki.item_id === linha.itemId)?.item
      if (atual) return [...lista, { id: atual.id, name: atual.name, unit: atual.unit, active: false } as InventoryItem]
    }
    return lista
  }

  function atualizar(key: number, parte: Partial<Linha>) {
    setLinhas((ls) => ls.map((l) => (l.key === key ? { ...l, ...parte } : l)))
  }

  async function salvar() {
    if (!podeSalvar || emAndamento.current) return
    emAndamento.current = true
    setEnviando(true)
    setErro('')
    try {
      const body: Record<string, unknown> = {
        name: nome.trim(),
        items: linhas.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantidade) })),
      }
      if (kit) body.active = ativo
      const res = await fetch(kit ? `/api/estoque/kits/${kit.id}` : '/api/estoque/kits', {
        method: kit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(json.error ?? 'Não foi possível salvar. Tente novamente.'); return }
      onSaved()
    } catch {
      setErro('Não foi possível concluir. Verifique a conexão e tente novamente.')
    } finally {
      emAndamento.current = false
      setEnviando(false)
    }
  }

  return (
    <ModalBase
      titulo={kit ? 'Editar kit' : 'Novo kit'}
      onClose={onClose}
      bloqueado={enviando}
      largo
      rodape={
        <>
          <button onClick={onClose} disabled={enviando} className={btnSecCls}>Cancelar</button>
          <button onClick={salvar} disabled={!podeSalvar} className={btnPriCls}>{enviando ? 'Salvando...' : 'Salvar'}</button>
        </>
      }
    >
      {erro && <CaixaErro>{erro}</CaixaErro>}

      <div>
        <label htmlFor="kit-nome" className={labelCls}>Nome *</label>
        <input id="kit-nome" className={inputCls} value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} />
      </div>

      {kit && (
        <label className="flex items-center gap-2 text-sm text-tinta">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} className="w-4 h-4 accent-petroleo" />
          Ativo
        </label>
      )}

      <div className="space-y-2">
        <p className={labelCls}>Produtos do kit</p>
        {linhas.map((l, i) => (
          <div key={l.key} className="flex items-center gap-2">
            <select className={inputCls} aria-label={`Produto ${i + 1}`} value={l.itemId}
              onChange={(e) => atualizar(l.key, { itemId: e.target.value })}>
              <option value="">Selecione o produto</option>
              {opcoes(l).map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.unit ? ` (${p.unit})` : ''}{p.active ? '' : ' - inativo'}</option>
              ))}
            </select>
            <input className={`${inputCls} !w-24 shrink-0`} inputMode="numeric" aria-label={`Quantidade ${i + 1}`}
              value={l.quantidade} onChange={(e) => atualizar(l.key, { quantidade: e.target.value })} />
            <button type="button" onClick={() => setLinhas((ls) => ls.filter((x) => x.key !== l.key))}
              className="p-2 rounded text-tinta-4 hover:text-tinta-2" aria-label={`Remover produto ${i + 1}`}>
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        {temRepetido && <p className="text-xs text-red-600">Há produtos repetidos no kit.</p>}
        {linhas.some((l) => !qtdOk(l.quantidade)) && <p className="text-xs text-red-600">A quantidade deve ser um número inteiro de 1 a 9999.</p>}
        <button type="button" onClick={() => setLinhas((ls) => [...ls, { key: novaKey(), itemId: '', quantidade: '1' }])}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-linha text-sm text-tinta hover:bg-porcelana-2">
          <Plus className="w-4 h-4" />
          Incluir produto
        </button>
      </div>
    </ModalBase>
  )
}
