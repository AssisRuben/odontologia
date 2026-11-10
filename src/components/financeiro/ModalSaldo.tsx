'use client'

import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { parseReaisInput } from '@/lib/payments/money'
import { todayLocal } from '@/components/financeiro/ModalDespesa'

const inputCls = 'w-full h-10 px-3 rounded-lg border border-linha text-sm bg-white focus:outline-none focus:ring-2 focus:ring-petroleo'

function ontemLocal(hoje: string): string {
  const [y, m, d] = hoje.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d - 1))
  return dt.toISOString().slice(0, 10)
}

export default function ModalSaldo({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const hoje = todayLocal()
  const [data, setData] = useState(() => ontemLocal(hoje))
  const [valor, setValor] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)

  async function handleSubmit() {
    if (inFlight.current) return
    setError('')
    const t = valor.trim()
    const negativo = t.startsWith('-')
    const abs = parseReaisInput(negativo ? t.slice(1) : t)
    if (abs === null) { setError('Valor inválido'); return }
    if (!data) { setError('Data inválida'); return }
    if (data > hoje) { setError('A data não pode ser futura'); return }
    const valorCentavos = negativo ? -abs : abs
    inFlight.current = true
    setSubmitting(true)
    try {
      const res = await fetch('/api/financeiro/saldo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, valorCentavos }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setError(json.error || 'Não foi possível salvar o saldo. Tente novamente.')
        return
      }
      onSaved()
      onClose()
    } catch {
      setError('Não foi possível concluir. Verifique a conexão e tente novamente.')
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={submitting ? undefined : onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-linha">
          <h2 className="text-base font-semibold text-tinta">Informar saldo</h2>
          <button onClick={onClose} className="p-1 rounded text-tinta-4 hover:text-tinta-2" aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label htmlFor="sd-data" className="block text-sm font-medium text-tinta mb-1">Data</label>
            <input id="sd-data" type="date" value={data} max={hoje} onChange={(e) => setData(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label htmlFor="sd-valor" className="block text-sm font-medium text-tinta mb-1">Saldo no fim do dia (R$)</label>
            <input id="sd-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)}
              placeholder="0,00" className={inputCls} />
            <p className="text-xs text-tinta-4 mt-1">Informe o saldo da conta no fim do dia escolhido. Movimentos desse dia já devem estar no valor.</p>
            <p className="text-xs text-tinta-4 mt-1">Use o sinal de menos se a conta estiver negativa.</p>
          </div>
          {error && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} disabled={submitting}
              className="flex-1 h-10 rounded-lg border border-linha text-sm font-medium text-tinta-3 hover:bg-porcelana disabled:opacity-50">
              Cancelar
            </button>
            <button type="button" onClick={handleSubmit} disabled={submitting}
              className="flex-1 h-10 rounded-lg bg-petroleo text-white text-sm font-medium hover:bg-petroleo-escuro disabled:opacity-50">
              {submitting ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
