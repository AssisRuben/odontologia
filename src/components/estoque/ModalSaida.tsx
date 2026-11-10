'use client'

import { useMemo, useRef, useState } from 'react'
import type { InventoryItem } from '@/types'
import { KIND_LABEL, KINDS_SAIDA } from '@/lib/estoque/rotulos'
import { ordemFefo, planoSaida } from '@/lib/estoque/fefo'
import { rotuloLote } from '@/lib/estoque/formatar'
import { ModalBase, CaixaErro, inputCls, labelCls, btnPriCls, btnSecCls } from './ModalBase'

interface Props {
  item: InventoryItem
  hojeYmd: string
  onClose: () => void
  onSaved: (msg?: string) => void
  onInsuficiente: () => void
}

export function ModalSaida({ item, onClose, onSaved, onInsuficiente }: Props) {
  const [qtd, setQtd] = useState('')
  const [kind, setKind] = useState<(typeof KINDS_SAIDA)[number]>('uso')
  const [loteId, setLoteId] = useState('')
  const [obs, setObs] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const emAndamento = useRef(false)

  const lotes = useMemo(() => ordemFefo((item.lots ?? []).filter((l) => l.quantity > 0)), [item.lots])
  const comLotes = item.tracks_expiry && lotes.length > 0
  const loteEscolhido = lotes.find((l) => l.id === loteId)
  const saldo = loteEscolhido ? loteEscolhido.quantity : item.quantity
  const qtdN = /^\d+$/.test(qtd.trim()) ? Number(qtd.trim()) : 0
  const insuficiente = qtdN > saldo
  const plano = comLotes && !loteEscolhido && qtdN > 0 && !insuficiente ? planoSaida(lotes, qtdN) : null
  const podeSalvar = qtdN > 0 && !insuficiente && !enviando

  async function salvar() {
    if (!podeSalvar || emAndamento.current) return
    emAndamento.current = true
    setEnviando(true)
    setErro('')
    try {
      const res = await fetch(`/api/estoque/${item.id}/saida`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: qtdN, kind, lotId: loteId || null, notes: obs.trim() || null }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 409 && json.error === 'Estoque insuficiente') { onInsuficiente(); return }
      if (!res.ok) { setErro(json.error ?? 'Não foi possível salvar. Tente novamente.'); return }
      onSaved('Saída registrada')
    } catch {
      setErro('Não foi possível concluir. Verifique a conexão e tente novamente.')
    } finally {
      emAndamento.current = false
      setEnviando(false)
    }
  }

  return (
    <ModalBase
      titulo={`Saída — ${item.name}`}
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
      <p className="text-sm text-tinta-3">Saldo atual: <span className="font-medium text-tinta">{item.quantity} {item.unit ?? ''}</span></p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="sai-qtd" className={labelCls}>Quantidade *</label>
          <input id="sai-qtd" className={inputCls} inputMode="numeric" value={qtd} onChange={(e) => setQtd(e.target.value)} />
        </div>
        <div>
          <label htmlFor="sai-motivo" className={labelCls}>Motivo</label>
          <select id="sai-motivo" className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {KINDS_SAIDA.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </div>
      </div>
      {insuficiente && <p role="alert" className="text-xs text-red-600 -mt-2">Estoque insuficiente</p>}

      {comLotes && (
        <>
          <div>
            <label htmlFor="sai-lote" className={labelCls}>Sair de um lote específico</label>
            <select id="sai-lote" className={inputCls} value={loteId} onChange={(e) => setLoteId(e.target.value)}>
              <option value="">Automático (vence primeiro)</option>
              {lotes.map((l) => <option key={l.id} value={l.id}>{rotuloLote(l)}: {l.quantity}</option>)}
            </select>
          </div>
          {plano && (
            <ul className="text-sm text-tinta-2 rounded-lg bg-porcelana-2 p-3 space-y-1">
              {plano.map((p) => {
                const l = lotes.find((x) => x.id === p.lotId)
                return l ? <li key={p.lotId}>{rotuloLote(l)}: {p.quantidade}</li> : null
              })}
            </ul>
          )}
        </>
      )}

      <div>
        <label htmlFor="sai-obs" className={labelCls}>Observação</label>
        <input id="sai-obs" className={inputCls} maxLength={500} value={obs} onChange={(e) => setObs(e.target.value)} />
      </div>
    </ModalBase>
  )
}
