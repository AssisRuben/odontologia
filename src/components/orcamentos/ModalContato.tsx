'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import { todayYmd } from '@/lib/messaging/time'
import { addDaysYmd, contactOutcome } from '@/lib/orcamentos/contato'
import type { BudgetContactOutcome } from '@/types'

interface Props {
  budgetId: string
  patientName: string
  onClose: () => void
  onSaved: () => void
  /** 'aprovou' ou 'perdido': o contato já foi gravado, falta decidir. */
  onDecide: (mode: 'approve' | 'lose') => void
}

const OPTIONS: { value: BudgetContactOutcome; label: string }[] = [
  { value: 'nao_atendeu', label: 'Não atendeu (ligar amanhã)' },
  { value: 'pensar', label: 'Vai pensar' },
  { value: 'aprovou', label: 'Aprovou por telefone' },
  { value: 'perdido', label: 'Não vai fazer (perdido)' },
]

export function ModalContato({ budgetId, patientName, onClose, onSaved, onDecide }: Props) {
  const { clinicId } = useClinicStore()
  const today = todayYmd(new Date(), 'America/Sao_Paulo')
  const [outcome, setOutcome] = useState<BudgetContactOutcome>('nao_atendeu')
  const [date, setDate] = useState(addDaysYmd(today, 3))
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!clinicId) return
    setError('')
    if (outcome === 'pensar' && (!date || date < today)) { setError('Escolha uma data a partir de hoje'); return }
    setSaving(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setError('Sessão expirada. Entre de novo.'); return }
      const r = contactOutcome(outcome, outcome === 'pensar' ? date : null, today)
      const ev = await supabase.from('budget_events').insert({
        budget_id: budgetId, clinic_id: clinicId, type: 'contact', outcome,
        note: note.trim() || null, created_by: user.id,
      })
      if (ev.error) { setError('Não foi possível registrar o contato.'); return }
      if (r.next === 'none') {
        const up = await supabase.from('budgets').update({ followup_at: r.followup_at })
          .eq('id', budgetId).eq('clinic_id', clinicId)
        if (up.error) { setError('Contato registrado, mas não foi possível agendar o retorno.'); return }
        onSaved()
      } else {
        onDecide(r.next)
      }
    } catch {
      setError('Falha de conexão. Tente de novo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl w-full max-w-md p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-[#111827]">Registrar contato: {patientName}</h2>
          <button onClick={onClose} aria-label="Fechar" className="p-1 text-[#6B7280]"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-2">
          {OPTIONS.map(o => (
            <label key={o.value} className="flex items-center gap-2 text-sm text-[#374151]">
              <input type="radio" name="outcome" checked={outcome === o.value} onChange={() => setOutcome(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
        {outcome === 'pensar' && (
          <label className="block text-sm text-[#374151]">Ligar de novo em
            <input type="date" value={date} min={today} onChange={e => setDate(e.target.value)}
              className="mt-1 w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm" />
          </label>
        )}
        <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={500} rows={3}
          placeholder="Observação (opcional)" className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm" />
        {error && <p className="text-sm text-[#EF4444]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 h-9 rounded-lg border border-[#E5E7EB] text-sm text-[#374151]">Cancelar</button>
          <button onClick={save} disabled={saving || !clinicId}
            className="px-4 h-9 rounded-lg bg-[#3B82F6] text-white text-sm font-medium disabled:opacity-50">
            {saving ? 'Salvando…' : outcome === 'aprovou' || outcome === 'perdido' ? 'Continuar' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
