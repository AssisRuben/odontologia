'use client'

import { useMemo, useRef, useState } from 'react'
import type { InventoryItem } from '@/types'
import { ordemFefo } from '@/lib/estoque/fefo'
import { rotuloLote } from '@/lib/estoque/formatar'
import { ModalBase, CaixaErro, inputCls, labelCls, btnPriCls, btnSecCls } from './ModalBase'

interface Props {
  item: InventoryItem
  hojeYmd: string
  onClose: () => void
  onSaved: (msg?: string) => void
}

function diferencaTexto(d: number): string {
  return d > 0 ? `+${d}` : `−${Math.abs(d)} unid.`
}

export function ModalContagem({ item, onClose, onSaved }: Props) {
  const lotes = useMemo(() => ordemFefo((item.lots ?? []).filter((l) => l.quantity > 0)), [item.lots])
  const porLote = item.tracks_expiry
  const [valores, setValores] = useState<Record<string, string>>({})
  const [obs, setObs] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const emAndamento = useRef(false)

  // Um campo por lote (com validade) ou um campo único.
  const linhas = porLote
    ? lotes.map((l) => ({ chave: l.id, lotId: l.id as string | null, rotulo: rotuloLote(l), atual: l.quantity }))
    : [{ chave: 'item', lotId: null as string | null, rotulo: 'Quantidade contada', atual: item.quantity }]

  const analise = linhas.map((l) => {
    const t = (valores[l.chave] ?? '').trim()
    const contado = /^\d+$/.test(t) ? Number(t) : null
    return { ...l, contado, invalido: t !== '' && contado === null, diff: contado === null ? 0 : contado - l.atual }
  })
  const alteradas = analise.filter((l) => l.contado !== null && l.diff !== 0)
  const podeSalvar = alteradas.length > 0 && !analise.some((l) => l.invalido) && !enviando

  async function salvar() {
    if (!podeSalvar || emAndamento.current) return
    emAndamento.current = true
    setEnviando(true)
    setErro('')
    let feitas = 0
    try {
      for (const l of alteradas) {
        const res = await fetch(`/api/estoque/${item.id}/contagem`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ counted: l.contado, lotId: l.lotId, notes: obs.trim() || null }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          const base = json.error ?? 'Não foi possível salvar. Tente novamente.'
          setErro(feitas > 0 ? `${base} ${feitas} de ${alteradas.length} lotes já foram ajustados; feche e confira os saldos.` : base)
          return
        }
        feitas++
      }
      onSaved('Contagem registrada')
    } catch {
      setErro('Não foi possível concluir. Verifique a conexão e tente novamente.')
    } finally {
      emAndamento.current = false
      setEnviando(false)
    }
  }

  return (
    <ModalBase
      titulo={`Contagem — ${item.name}`}
      onClose={onClose}
      bloqueado={enviando}
      rodape={
        <>
          <button onClick={onClose} disabled={enviando} className={btnSecCls}>Cancelar</button>
          <button onClick={salvar} disabled={!podeSalvar} className={btnPriCls}>{enviando ? 'Salvando...' : 'Confirmar'}</button>
        </>
      }
    >
      {erro && <CaixaErro>{erro}</CaixaErro>}
      <p className="text-sm text-tinta-3">Saldo no sistema: <span className="font-medium text-tinta">{item.quantity} {item.unit ?? ''}</span></p>
      {porLote && lotes.length === 0 && <p className="text-sm text-tinta-3">Este produto não tem lotes com saldo para contar.</p>}

      {analise.map((l) => (
        <div key={l.chave} className="flex items-end gap-3">
          <div className="flex-1">
            <label htmlFor={`cont-${l.chave}`} className={labelCls}>{l.rotulo} <span className="text-tinta-4 font-normal">(sistema: {l.atual})</span></label>
            <input id={`cont-${l.chave}`} className={inputCls} inputMode="numeric" value={valores[l.chave] ?? ''}
              onChange={(e) => setValores((v) => ({ ...v, [l.chave]: e.target.value }))} />
          </div>
          <span className="w-20 pb-2 text-sm font-medium text-tinta-2">{l.contado !== null && l.diff !== 0 ? diferencaTexto(l.diff) : ''}</span>
        </div>
      ))}
      {analise.some((l) => l.invalido) && <p className="text-xs text-red-600">Use apenas números inteiros.</p>}

      <div>
        <label htmlFor="cont-obs" className={labelCls}>Observação</label>
        <input id="cont-obs" className={inputCls} maxLength={500} value={obs} onChange={(e) => setObs(e.target.value)} />
      </div>
    </ModalBase>
  )
}
