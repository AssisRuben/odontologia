'use client'

import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { parseReaisInput, fromCents } from '@/lib/payments/money'
import { formatCurrency } from '@/lib/utils'
import { errorText } from './errorText'

interface Props {
  paymentId: string
  /** Valor sugerido, em reais. */
  defaultAmount: number
  /** Cartão parcelado: o valor é o total do parcelamento, calculado pelo servidor. */
  isGroup?: boolean
  defaultDescription: string
  onClose: () => void
  onDone: () => void
}

const inputCls = 'w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#3B82F6]'

export function ModalEmitirNota({ paymentId, defaultAmount, isGroup, defaultDescription, onClose, onDone }: Props) {
  const [description, setDescription] = useState(defaultDescription)
  const initialValue = fromCents(Math.round(defaultAmount * 100)).toFixed(2).replace('.', ',')
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inFlight = useRef(false)

  async function submit() {
    if (inFlight.current) return
    const cents = parseReaisInput(value)
    if (cents === null || cents <= 0) { setError('Informe um valor válido.'); return }
    if (!description.trim()) { setError('Informe a descrição da nota.'); return }
    inFlight.current = true
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(`/api/payments/${paymentId}/invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value.trim() === initialValue ? { description: description.trim() } : { description: description.trim(), valueCents: cents }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(errorText(res.status, data, 'Não foi possível emitir a nota.'))
        return
      }
      onClose()
      onDone()
    } catch {
      setError('Falha de conexão. Tente novamente.')
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={submitting ? undefined : onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[#E5E7EB]">
          <h2 className="text-base font-semibold text-[#111827]">Emitir nota fiscal</h2>
          <button onClick={onClose} disabled={submitting} className="p-1 rounded text-[#9CA3AF] hover:text-[#374151]" aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label htmlFor="en-valor" className="block text-sm font-medium text-[#111827] mb-1">{isGroup ? 'Valor total do parcelamento (calculado pelo sistema)' : 'Valor da nota (R$)'}</label>
            <input id="en-valor" inputMode="decimal" className={inputCls} value={value} onChange={e => setValue(e.target.value)} />
            <p className="text-xs text-[#6B7280] mt-1">{isGroup ? 'Total estimado' : 'Valor do pagamento'}: {formatCurrency(defaultAmount)}</p>
          </div>
          <div>
            <label htmlFor="en-desc" className="block text-sm font-medium text-[#111827] mb-1">Descrição do serviço</label>
            <textarea id="en-desc" rows={3} className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
              value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} disabled={submitting} className="h-10 px-4 rounded-lg border border-[#E5E7EB] text-sm text-[#374151] hover:bg-[#F9FAFB]">Cancelar</button>
            <button onClick={submit} disabled={submitting} className="h-10 px-4 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-[#2563EB] disabled:opacity-60">
              {submitting ? 'Emitindo…' : 'Emitir nota'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
