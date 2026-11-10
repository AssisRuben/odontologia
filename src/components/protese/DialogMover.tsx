'use client'

import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Prosthetic, ProstheticStatus } from '@/types'
import { etapa } from '@/lib/protese/etapas'

interface Props {
  protese: Prosthetic
  para: ProstheticStatus
  onClose: () => void
  onMoved: (r: { expense: { amount: number } | null }) => void
  onConflito: () => void
}

const inputCls = 'w-full h-10 px-3 rounded-lg border border-linha text-sm bg-white focus:outline-none focus:ring-2 focus:ring-petroleo'

export function DialogMover({ protese, para, onClose, onMoved, onConflito }: Props) {
  const [observacao, setObservacao] = useState('')
  const [previsao, setPrevisao] = useState(protese.expected_at?.slice(0, 10) ?? '')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const emAndamento = useRef(false)
  const destino = etapa(para)

  async function confirmar() {
    if (emAndamento.current) return
    emAndamento.current = true
    setEnviando(true)
    setErro('')
    try {
      const body: Record<string, unknown> = { de: protese.status, para }
      if (observacao.trim()) body.observacao = observacao.trim()
      if (para === 'sent_to_lab' && previsao) body.previsao = previsao
      const res = await fetch(`/api/protese/${protese.id}/mover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 409) { onConflito(); return }
      if (!res.ok) { setErro(json.error ?? 'Não foi possível mover. Tente novamente.'); return }
      onMoved({ expense: json.expense ?? null })
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
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-5 border-b border-linha">
          <h2 className="text-base font-semibold text-tinta flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: destino.cor }} />
            Mover para {destino.rotulo}
          </h2>
          <button onClick={onClose} disabled={enviando} className="p-1 rounded text-tinta-4 hover:text-tinta-2" aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {para === 'sent_to_lab' && (
            <div>
              <label htmlFor="mv-prev" className="block text-sm font-medium text-tinta mb-1">Previsão de retorno</label>
              <input id="mv-prev" type="date" value={previsao} onChange={(e) => setPrevisao(e.target.value)} className={inputCls} />
            </div>
          )}
          <div>
            <label htmlFor="mv-obs" className="block text-sm font-medium text-tinta mb-1">Observação (opcional)</label>
            <textarea id="mv-obs" rows={2} maxLength={300} value={observacao} onChange={(e) => setObservacao(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-linha text-sm bg-white focus:outline-none focus:ring-2 focus:ring-petroleo" />
          </div>
          {erro && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} disabled={enviando}
              className="flex-1 h-10 rounded-lg border border-linha text-sm font-medium text-tinta-3 hover:bg-porcelana disabled:opacity-50">
              Cancelar
            </button>
            <button type="button" onClick={confirmar} disabled={enviando}
              className="flex-1 h-10 rounded-lg bg-petroleo text-white text-sm font-medium hover:bg-petroleo-escuro disabled:opacity-50">
              {enviando ? 'Movendo...' : 'Confirmar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
