'use client'

import { useState, useEffect } from 'react'
import { Plus, X, Trash2, FileText, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'

interface BudgetItem {
  id: string
  budget_id: string
  procedure: string
  tooth: string | null
  quantity: number
  unit_price: number
  status: 'pending' | 'in_progress' | 'completed'
}

interface Budget {
  id: string
  patient_id: string
  clinic_id: string
  status: 'draft' | 'approved' | 'rejected' | 'completed'
  notes: string | null
  total: number
  created_at: string
  items?: BudgetItem[]
}

interface Props {
  patientId: string
  clinicId: string
}

const BUDGET_STATUS = {
  draft:     { label: 'Rascunho',  color: '#6B7280', bg: '#F3F4F6', icon: Clock },
  approved:  { label: 'Aprovado',  color: '#10B981', bg: '#ECFDF5', icon: CheckCircle2 },
  rejected:  { label: 'Recusado', color: '#EF4444', bg: '#FEF2F2', icon: XCircle },
  completed: { label: 'Concluído', color: '#3B82F6', bg: '#EFF6FF', icon: CheckCircle2 },
}

const ITEM_STATUS = {
  pending:     { label: 'Pendente',    color: '#F59E0B' },
  in_progress: { label: 'Em andamento', color: '#3B82F6' },
  completed:   { label: 'Concluído',   color: '#10B981' },
}

export function TabOrcamentos({ patientId, clinicId }: Props) {
  const [budgets, setBudgets]   = useState<Budget[]>([])
  const [loading, setLoading]   = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  async function load() {
    const supabase = createClient()
    const { data } = await supabase
      .from('budgets')
      .select('*, items:budget_items(*)')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
    if (data) setBudgets(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [patientId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function updateStatus(id: string, status: Budget['status']) {
    const supabase = createClient()
    await supabase.from('budgets').update({ status }).eq('id', id)
    load()
  }

  async function updateItemStatus(id: string, status: BudgetItem['status']) {
    const supabase = createClient()
    await supabase.from('budget_items').update({ status }).eq('id', id)
    load()
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-7 h-7 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-[#6B7280]">{budgets.length} orçamento(s)</p>
        <button onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-4 h-9 bg-[#3B82F6] text-white text-sm font-medium rounded-lg hover:bg-[#2563EB] transition-colors">
          <Plus className="w-4 h-4" /> Novo orçamento
        </button>
      </div>

      {budgets.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#E5E7EB] flex flex-col items-center justify-center h-48 gap-3">
          <FileText className="w-10 h-10 text-[#D1D5DB]" />
          <p className="text-sm text-[#6B7280]">Nenhum orçamento cadastrado.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {budgets.map((b) => {
            const cfg = BUDGET_STATUS[b.status]
            const Icon = cfg.icon
            const expanded = expandedId === b.id
            const items = b.items || []
            const total = items.reduce((s, i) => s + i.unit_price * i.quantity, 0)

            return (
              <div key={b.id} className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
                <button
                  onClick={() => setExpandedId(expanded ? null : b.id)}
                  className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-[#F9FAFB] transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
                        style={{ backgroundColor: cfg.bg, color: cfg.color }}>
                        <Icon className="w-3 h-3" />
                        {cfg.label}
                      </span>
                      <span className="text-xs text-[#9CA3AF]">
                        {format(parseISO(b.created_at), "d MMM yyyy", { locale: ptBR })}
                      </span>
                    </div>
                    <p className="text-xs text-[#6B7280]">{items.length} procedimento(s)</p>
                  </div>
                  <p className="text-base font-bold text-[#111827] shrink-0">{formatCurrency(total)}</p>
                </button>

                {expanded && (
                  <div className="border-t border-[#F3F4F6]">
                    {/* Itens */}
                    <div className="divide-y divide-[#F9FAFB]">
                      {items.map((item) => {
                        const ist = ITEM_STATUS[item.status]
                        return (
                          <div key={item.id} className="flex items-center gap-3 px-5 py-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-[#111827]">{item.procedure}</p>
                              <p className="text-xs text-[#6B7280]">
                                {item.tooth ? `Dente ${item.tooth} · ` : ''}
                                Qtd {item.quantity} · {formatCurrency(item.unit_price)} un.
                              </p>
                            </div>
                            <select
                              value={item.status}
                              onChange={e => updateItemStatus(item.id, e.target.value as BudgetItem['status'])}
                              className="h-7 px-2 rounded-lg border border-[#E5E7EB] text-xs bg-white focus:outline-none"
                              style={{ color: ist.color }}
                            >
                              {Object.entries(ITEM_STATUS).map(([v, c]) => (
                                <option key={v} value={v}>{c.label}</option>
                              ))}
                            </select>
                            <p className="text-sm font-semibold text-[#111827] shrink-0 w-20 text-right">
                              {formatCurrency(item.unit_price * item.quantity)}
                            </p>
                          </div>
                        )
                      })}
                    </div>

                    {b.notes && (
                      <p className="px-5 py-3 text-xs text-[#6B7280] italic border-t border-[#F9FAFB]">{b.notes}</p>
                    )}

                    {/* Ações de status do orçamento */}
                    <div className="flex items-center justify-between px-5 py-3 border-t border-[#F3F4F6] bg-[#FAFAFA]">
                      <span className="text-xs text-[#6B7280]">Alterar status:</span>
                      <div className="flex gap-2">
                        {b.status !== 'approved' && (
                          <button onClick={() => updateStatus(b.id, 'approved')}
                            className="px-3 h-7 rounded-lg bg-[#ECFDF5] text-[#10B981] text-xs font-medium hover:bg-[#D1FAE5] transition-colors">
                            Aprovar
                          </button>
                        )}
                        {b.status !== 'rejected' && (
                          <button onClick={() => updateStatus(b.id, 'rejected')}
                            className="px-3 h-7 rounded-lg bg-[#FEF2F2] text-[#EF4444] text-xs font-medium hover:bg-[#FEE2E2] transition-colors">
                            Recusar
                          </button>
                        )}
                        {b.status === 'approved' && (
                          <button onClick={() => updateStatus(b.id, 'completed')}
                            className="px-3 h-7 rounded-lg bg-[#EFF6FF] text-[#3B82F6] text-xs font-medium hover:bg-[#DBEAFE] transition-colors">
                            Concluir
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showModal && (
        <ModalNovoOrcamento
          patientId={patientId}
          clinicId={clinicId}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load() }}
        />
      )}
    </div>
  )
}

// ─── Modal novo orçamento ─────────────────────────────────────────────────────

interface ItemForm { id: string; procedure: string; tooth: string; quantity: string; unit_price: string }

function newItem(): ItemForm {
  return { id: crypto.randomUUID(), procedure: '', tooth: '', quantity: '1', unit_price: '' }
}

function ModalNovoOrcamento({ patientId, clinicId, onClose, onSaved }: {
  patientId: string; clinicId: string; onClose: () => void; onSaved: () => void
}) {
  const [items, setItems] = useState<ItemForm[]>([newItem()])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const total = items.reduce((s, i) => {
    const qty = parseFloat(i.quantity) || 0
    const price = parseFloat(i.unit_price) || 0
    return s + qty * price
  }, 0)

  function updateItem(id: string, patch: Partial<ItemForm>) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i))
  }

  async function handleSave() {
    const valid = items.filter(i => i.procedure.trim() && parseFloat(i.unit_price) > 0)
    if (valid.length === 0) { setError('Adicione ao menos um procedimento com valor.'); return }
    setError('')
    setSaving(true)
    const supabase = createClient()

    const { data: budget } = await supabase.from('budgets').insert({
      clinic_id: clinicId, patient_id: patientId,
      status: 'draft', notes: notes || null, total,
    }).select().single()

    if (budget) {
      await supabase.from('budget_items').insert(
        valid.map(i => ({
          budget_id: budget.id,
          procedure: i.procedure.trim(),
          tooth: i.tooth || null,
          quantity: parseInt(i.quantity) || 1,
          unit_price: parseFloat(i.unit_price),
          status: 'pending',
        }))
      )
    }
    setSaving(false)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-xl mx-4 max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[#E5E7EB] shrink-0">
          <h2 className="text-base font-semibold text-[#111827]">Novo orçamento</h2>
          <button onClick={onClose} className="p-1 rounded text-[#9CA3AF] hover:text-[#374151]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="space-y-3">
            {items.map((item, idx) => (
              <div key={item.id} className="bg-[#F9FAFB] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-[#6B7280]">Procedimento {idx + 1}</p>
                  {items.length > 1 && (
                    <button onClick={() => setItems(prev => prev.filter(i => i.id !== item.id))}
                      className="p-1 rounded text-[#9CA3AF] hover:text-red-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <input
                  value={item.procedure}
                  onChange={e => updateItem(item.id, { procedure: e.target.value })}
                  placeholder="Nome do procedimento"
                  className="w-full h-9 px-3 rounded-lg border border-[#E5E7EB] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
                />
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs text-[#6B7280] mb-1">Dente</label>
                    <input value={item.tooth} onChange={e => updateItem(item.id, { tooth: e.target.value })}
                      placeholder="Ex: 36"
                      className="w-full h-9 px-3 rounded-lg border border-[#E5E7EB] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#3B82F6]" />
                  </div>
                  <div>
                    <label className="block text-xs text-[#6B7280] mb-1">Qtd</label>
                    <input type="number" min="1" value={item.quantity} onChange={e => updateItem(item.id, { quantity: e.target.value })}
                      className="w-full h-9 px-3 rounded-lg border border-[#E5E7EB] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#3B82F6]" />
                  </div>
                  <div>
                    <label className="block text-xs text-[#6B7280] mb-1">Valor un. (R$)</label>
                    <input type="number" step="0.01" min="0" value={item.unit_price} onChange={e => updateItem(item.id, { unit_price: e.target.value })}
                      placeholder="0,00"
                      className="w-full h-9 px-3 rounded-lg border border-[#E5E7EB] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#3B82F6]" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button onClick={() => setItems(prev => [...prev, newItem()])}
            className="w-full flex items-center justify-center gap-1.5 h-9 rounded-xl border border-dashed border-[#D1D5DB] text-sm text-[#6B7280] hover:border-[#3B82F6] hover:text-[#3B82F6] transition-colors">
            <Plus className="w-4 h-4" /> Adicionar procedimento
          </button>

          <div>
            <label className="block text-sm font-medium text-[#111827] mb-1">Observações</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] resize-none" />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="p-5 border-t border-[#E5E7EB] flex items-center gap-3 shrink-0">
          <div className="flex-1">
            <p className="text-xs text-[#6B7280]">Total</p>
            <p className="text-lg font-bold text-[#111827]">{formatCurrency(total)}</p>
          </div>
          <button onClick={onClose}
            className="h-10 px-4 rounded-lg border border-[#E5E7EB] text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6]">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="h-10 px-6 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-[#2563EB] disabled:opacity-50">
            {saving ? 'Salvando...' : 'Criar orçamento'}
          </button>
        </div>
      </div>
    </div>
  )
}
