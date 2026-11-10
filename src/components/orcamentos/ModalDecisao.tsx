'use client'

import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import { LOST_REASONS } from '@/lib/orcamentos/etapas'

export interface DecisaoItem { id: string; procedure: string; tooth: string | null; quantity: number; unit_price: number }

interface Props {
  budget: { id: string; items?: DecisaoItem[] }
  mode: 'approve' | 'lose'
  onClose: () => void
  onDone: () => void
}

const inputCls = 'w-full h-10 px-3 rounded-lg border border-linha text-sm bg-white focus:outline-none focus:ring-2 focus:ring-petroleo'

export function ModalDecisao({ budget, mode, onClose, onDone }: Props) {
  const [items, setItems] = useState<DecisaoItem[] | null>(budget.items ?? null)
  const [checked, setChecked] = useState<Set<string>>(new Set(budget.items?.map(i => i.id) ?? []))
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (mode !== 'approve' || budget.items) return
    let stale = false
    createClient().from('budget_items').select('id, procedure, tooth, quantity, unit_price')
      .eq('budget_id', budget.id).order('created_at')
      .then(({ data, error: err }) => {
        if (stale) return
        if (err) { setError('Não foi possível carregar os itens.'); setItems([]); return }
        const list = (data ?? []) as DecisaoItem[]
        setItems(list)
        setChecked(new Set(list.map(i => i.id)))
      })
    return () => { stale = true }
  }, [budget.id, budget.items, mode])

  const total = useMemo(
    () => (items ?? []).filter(i => checked.has(i.id)).reduce((s, i) => s + Number(i.unit_price) * i.quantity, 0),
    [items, checked],
  )

  function toggle(id: string) {
    setChecked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  async function submit() {
    setError('')
    if (mode === 'lose' && !reason) { setError('Escolha o motivo'); return }
    if (mode === 'approve' && checked.size === 0) { setError('Marque ao menos um item'); return }
    setSaving(true)
    try {
      const body = mode === 'approve'
        ? { action: 'approve', itemIds: [...checked] }
        : { action: 'lose', reason, ...(note.trim() ? { note: note.trim() } : {}) }
      const res = await fetch(`/api/orcamentos/${budget.id}/decisao`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error ?? 'Não foi possível salvar.'); return }
      onDone()
    } catch {
      setError('Falha de conexão. Tente de novo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-tinta">{mode === 'approve' ? 'Aprovar orçamento' : 'Marcar como perdido'}</h2>
          <button onClick={onClose} aria-label="Fechar" className="p-1 text-tinta-3"><X className="w-4 h-4" /></button>
        </div>

        {mode === 'approve' ? (
          <>
            {items === null ? <p className="text-sm text-tinta-3">Carregando itens…</p> : (
              <div className="space-y-2">
                {items.map(i => (
                  <label key={i.id} className="flex items-start gap-2 text-sm text-tinta-2">
                    <input type="checkbox" checked={checked.has(i.id)} onChange={() => toggle(i.id)} className="mt-1" />
                    <span className="flex-1">{i.procedure}{i.tooth ? ` (dente ${i.tooth})` : ''}{i.quantity > 1 ? ` × ${i.quantity}` : ''}</span>
                    <span>{formatCurrency(Number(i.unit_price) * i.quantity)}</span>
                  </label>
                ))}
                <p className="text-sm font-semibold text-tinta text-right">Total aprovado: {formatCurrency(total)}</p>
              </div>
            )}
            <p className="text-xs text-tinta-3">Aprovar sem assinatura do paciente? Ficará registrado como aprovado pela recepção.</p>
          </>
        ) : (
          <div className="space-y-3">
            <select value={reason} onChange={e => setReason(e.target.value)} className={inputCls}>
              <option value="">Motivo…</option>
              {LOST_REASONS.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
            <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={500} rows={3}
              placeholder="Observação (opcional)" className="w-full px-3 py-2 rounded-lg border border-linha text-sm" />
          </div>
        )}

        {error && <p className="text-sm text-[#EF4444]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 h-9 rounded-lg border border-linha text-sm text-tinta-2">Cancelar</button>
          <button onClick={submit} disabled={saving || (mode === 'approve' && items === null)}
            className="px-4 h-9 rounded-lg bg-petroleo text-white text-sm font-medium disabled:opacity-50">
            {saving ? 'Salvando…' : mode === 'approve' ? 'Aprovar' : 'Marcar como perdido'}
          </button>
        </div>
      </div>
    </div>
  )
}
