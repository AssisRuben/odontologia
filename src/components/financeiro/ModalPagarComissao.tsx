'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { todayYmd } from '@/lib/messaging/time'
import { rotuloMes } from '@/lib/comissoes/periodo'
import { brl } from './formatoComissao'

const FORMAS: { value: string; label: string }[] = [
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'pix', label: 'Pix' },
  { value: 'cartao_credito', label: 'Cartão de crédito' },
  { value: 'cartao_debito', label: 'Cartão de débito' },
  { value: 'boleto', label: 'Boleto' },
]

const inputCls = 'w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#3B82F6]'

interface Props {
  fechamentoId: string
  nome: string
  mes: string
  totalCentavos: number
  onClose: () => void
  onPaid: () => void
}

export default function ModalPagarComissao({ fechamentoId, nome, mes, totalCentavos, onClose, onPaid }: Props) {
  const [paidAt, setPaidAt] = useState(() => todayYmd(new Date(), 'America/Sao_Paulo'))
  const [paymentMethod, setPaymentMethod] = useState('pix')
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState('')

  async function confirmar() {
    if (busy) return
    setBusy(true)
    setErro('')
    try {
      const res = await fetch(`/api/comissoes/fechamentos/${fechamentoId}/pagamento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paidAt, paymentMethod }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErro(json.error || 'Não foi possível registrar o pagamento')
        return
      }
      onPaid()
    } catch {
      setErro('Não foi possível registrar o pagamento. Verifique a conexão.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={busy ? undefined : onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-5 border-b border-[#E5E7EB]">
          <h2 className="text-base font-semibold text-[#111827]">Marcar comissão como paga</h2>
          <button onClick={onClose} disabled={busy} className="p-1 rounded text-[#9CA3AF] hover:text-[#374151]" aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-[#374151]">
            {nome} · {rotuloMes(mes)} · <span className="font-semibold">{brl(totalCentavos)}</span>
          </p>
          <div>
            <label htmlFor="pc-data" className="block text-sm font-medium text-[#111827] mb-1">Data do pagamento</label>
            <input id="pc-data" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label htmlFor="pc-forma" className="block text-sm font-medium text-[#111827] mb-1">Forma de pagamento</label>
            <select id="pc-forma" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={inputCls}>
              {FORMAS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          {erro && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} disabled={busy}
              className="flex-1 h-10 rounded-lg border border-[#E5E7EB] text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] disabled:opacity-50">
              Cancelar
            </button>
            <button type="button" onClick={confirmar} disabled={busy || !paidAt}
              className="flex-1 h-10 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-[#2563EB] disabled:opacity-50">
              {busy ? 'Salvando...' : 'Confirmar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
