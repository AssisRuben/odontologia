'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, X, Trash2, FileText, CheckCircle2, XCircle, Clock, Send } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import { ModalNovaCobranca } from '@/components/pagamentos/ModalNovaCobranca'
import type { NovaCobrancaPatient } from '@/components/pagamentos/ModalNovaCobranca'
import { ModalDecisao } from '@/components/orcamentos/ModalDecisao'
import { STAGE_LABEL } from '@/lib/orcamentos/etapas'
import { actionsFor, eventLabel } from '@/lib/orcamentos/aba'
import type { Budget, BudgetEvent, BudgetItem, BudgetStatus } from '@/types'

interface Props {
  patientId: string
  clinicId: string
  patient?: NovaCobrancaPatient
}

interface Prof { id: string; name: string; user_id: string | null }

type Msg = { kind: 'ok' | 'err'; text: string; link?: string }

const BUDGET_STATUS: Record<BudgetStatus, { color: string; bg: string; icon: typeof Clock }> = {
  draft:     { color: '#5E6E75', bg: '#EEF2F2', icon: Clock },
  sent:      { color: '#B45309', bg: '#FFFBEB', icon: Send },
  approved:  { color: '#10B981', bg: '#ECFDF5', icon: CheckCircle2 },
  rejected:  { color: '#EF4444', bg: '#FEF2F2', icon: XCircle },
  expired:   { color: '#EF4444', bg: '#FEF2F2', icon: XCircle },
  completed: { color: '#173B47', bg: '#E4EFF2', icon: CheckCircle2 },
}

const ITEM_STATUS = {
  pending:     { label: 'Pendente',    color: '#F59E0B' },
  in_progress: { label: 'Em andamento', color: '#173B47' },
  completed:   { label: 'Concluído',   color: '#10B981' },
}

const SENT_EDIT_NOTICE = 'Ao alterar um orçamento enviado, o link atual deixa de funcionar e será preciso reenviar.'

const btn = 'px-3 h-7 rounded-lg text-xs font-medium transition-colors disabled:opacity-50'

export function TabOrcamentos({ patientId, clinicId, patient }: Props) {
  const [budgets, setBudgets]   = useState<Budget[]>([])
  const [events, setEvents]     = useState<Record<string, BudgetEvent[]>>({})
  const [profs, setProfs]       = useState<Prof[]>([])
  const [userId, setUserId]     = useState<string | null>(null)
  const [loading, setLoading]   = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [charged, setCharged] = useState<Record<string, number>>({})
  const [chargeBudget, setChargeBudget] = useState<{ id: string; total: number; label: string } | null>(null)
  const [decisao, setDecisao] = useState<{ budget: Budget; mode: 'approve' | 'lose' } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [resetN, setResetN] = useState(0)
  const [msgs, setMsgs] = useState<Record<string, Msg>>({})

  const setMsg = (id: string, m?: Msg) =>
    setMsgs(prev => {
      const next = { ...prev }
      if (m) next[id] = m; else delete next[id]
      return next
    })

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('budgets')
      .select('*, items:budget_items(*)')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
    if (data) {
      setBudgets(data as Budget[])
      const ids = data.map((b: Budget) => b.id)
      if (ids.length > 0) {
        const [{ data: pays }, { data: evs }] = await Promise.all([
          supabase.from('payments').select('budget_id, amount, status').in('budget_id', ids),
          supabase.from('budget_events').select('*').in('budget_id', ids).order('created_at', { ascending: true }),
        ])
        const sums: Record<string, number> = {}
        for (const p of (pays ?? []) as { budget_id: string; amount: number; status: string }[]) {
          if (p.status === 'cancelled' || p.status === 'refunded') continue
          sums[p.budget_id] = (sums[p.budget_id] ?? 0) + Number(p.amount)
        }
        setCharged(sums)
        const byBudget: Record<string, BudgetEvent[]> = {}
        for (const e of (evs ?? []) as BudgetEvent[]) (byBudget[e.budget_id] ??= []).push(e)
        setEvents(byBudget)
      } else {
        setCharged({})
        setEvents({})
      }
    }
    setLoading(false)
  }, [patientId])

  useEffect(() => {
    load() // eslint-disable-line react-hooks/set-state-in-effect
    const supabase = createClient()
    supabase.from('professionals').select('id, name, user_id').eq('clinic_id', clinicId).order('name')
      .then(({ data }) => setProfs((data ?? []) as Prof[]))
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
  }, [load, clinicId])

  function openCharge(b: Budget, total: number) {
    setChargeBudget({ id: b.id, total, label: `Orçamento #${b.id.replace(/-/g, '').slice(0, 6).toUpperCase()}` })
  }

  async function updateBudget(b: Budget, patch: Partial<Pick<Budget, 'status' | 'valid_until' | 'professional_id'>>) {
    setBusy(b.id)
    setMsg(b.id)
    const { error } = await createClient().from('budgets').update(patch).eq('id', b.id)
    if (error) setMsg(b.id, { kind: 'err', text: error.message })
    await load()
    setBusy(null)
  }

  function changeValidity(b: Budget, value: string) {
    if (value === (b.valid_until ?? '')) return
    if (b.status === 'sent' && !window.confirm(SENT_EDIT_NOTICE)) { setResetN(n => n + 1); return }
    updateBudget(b, { valid_until: value || null })
  }

  async function send(b: Budget, resend: boolean) {
    setBusy(b.id)
    setMsg(b.id)
    try {
      const res = await fetch(`/api/orcamentos/${b.id}/enviar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resend }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) setMsg(b.id, { kind: 'err', text: json.error ?? 'Não foi possível enviar.' })
      else if (json.sent === false) setMsg(b.id, { kind: 'err', text: json.warning ?? 'Orçamento não enviado por WhatsApp. Copie o link e envie manualmente.', link: json.link })
      else setMsg(b.id, { kind: 'ok', text: resend ? 'Orçamento reenviado.' : 'Orçamento enviado.', link: json.link })
    } catch {
      setMsg(b.id, { kind: 'err', text: 'Não foi possível enviar.' })
    }
    await load()
    setBusy(null)
  }

  async function copyLink(b: Budget, known?: string) {
    try {
      let link = known
      if (!link) {
        const res = await fetch(`/api/orcamentos/${b.id}/link`)
        const json = await res.json().catch(() => ({}))
        if (!res.ok) { setMsg(b.id, { kind: 'err', text: json.error ?? 'Link não encontrado. Reenvie o orçamento.' }); return }
        link = json.link as string
      }
      await navigator.clipboard.writeText(link)
      setMsg(b.id, { kind: 'ok', text: 'Link copiado' })
    } catch {
      setMsg(b.id, { kind: 'err', text: 'Não foi possível copiar o link.' })
    }
  }

  async function reopen(b: Budget) {
    setBusy(b.id)
    setMsg(b.id)
    const res = await fetch(`/api/orcamentos/${b.id}/decisao`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reopen' }),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setMsg(b.id, { kind: 'err', text: json.error ?? 'Não foi possível reabrir.' })
    }
    await load()
    setBusy(null)
  }

  async function openReceipt(b: Budget) {
    setMsg(b.id)
    const res = await fetch(`/api/orcamentos/${b.id}/comprovante`)
    if (!res.ok) { setMsg(b.id, { kind: 'err', text: 'Comprovante não encontrado' }); return }
    const blob = await res.blob()
    window.open(URL.createObjectURL(blob), '_blank')
  }

  async function updateItemStatus(budgetId: string, id: string, status: BudgetItem['status']) {
    setMsg(budgetId)
    const { error } = await createClient().from('budget_items').update({ status }).eq('id', id)
    if (error) setMsg(budgetId, { kind: 'err', text: error.message })
    load()
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-7 h-7 border-2 border-petroleo border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-tinta-3">{budgets.length} orçamento(s)</p>
        <button onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-4 h-9 bg-petroleo text-white text-sm font-medium rounded-lg hover:bg-petroleo-escuro transition-colors">
          <Plus className="w-4 h-4" /> Novo orçamento
        </button>
      </div>

      {budgets.length === 0 ? (
        <div className="bg-white rounded-xl border border-linha flex flex-col items-center justify-center h-48 gap-3">
          <FileText className="w-10 h-10 text-linha-forte" />
          <p className="text-sm text-tinta-3">Nenhum orçamento cadastrado.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {budgets.map((b) => {
            const cfg = BUDGET_STATUS[b.status]
            const Icon = cfg.icon
            const expanded = expandedId === b.id
            const items = b.items || []
            const itemsTotal = items.reduce((s, i) => s + i.unit_price * i.quantity, 0)
            const won = b.status === 'approved' || b.status === 'completed'
            const total = won ? Number(b.approved_total ?? itemsTotal) : itemsTotal
            const remaining = total - (charged[b.id] ?? 0)
            const act = actionsFor(b.status, remaining)
            const msg = msgs[b.id]
            const disabled = busy === b.id

            return (
              <div key={b.id} className="bg-white rounded-xl border border-linha overflow-hidden">
                <button
                  onClick={() => setExpandedId(expanded ? null : b.id)}
                  className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-porcelana-2 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
                        style={{ backgroundColor: cfg.bg, color: cfg.color }}>
                        <Icon className="w-3 h-3" />
                        {STAGE_LABEL[b.status]}
                      </span>
                      <span className="text-xs text-tinta-4">
                        {format(parseISO(b.created_at), "d MMM yyyy", { locale: ptBR })}
                      </span>
                    </div>
                    <p className="text-xs text-tinta-3">{items.length} procedimento(s)</p>
                    {won && (
                      <p className="text-xs text-tinta-3 mt-0.5">
                        Cobrado {formatCurrency(charged[b.id] ?? 0)} de {formatCurrency(total)}
                      </p>
                    )}
                  </div>
                  <p className="text-base font-bold text-tinta shrink-0">{formatCurrency(total)}</p>
                </button>

                {expanded && (
                  <div className="border-t border-porcelana">
                    <div className="flex flex-wrap items-center gap-4 px-5 py-3 bg-porcelana-2 border-b border-porcelana">
                      <label className="flex items-center gap-2 text-xs text-tinta-3">
                        Dentista
                        <select
                          value={b.professional_id ?? ''}
                          disabled={!act.editProfessional || disabled}
                          onChange={e => updateBudget(b, { professional_id: e.target.value || null })}
                          className="h-7 px-2 rounded-lg border border-linha text-xs bg-white disabled:bg-porcelana"
                        >
                          <option value="">Sem dentista</option>
                          {profs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </label>
                      <label className="flex items-center gap-2 text-xs text-tinta-3">
                        Validade
                        <input
                          type="date"
                          defaultValue={b.valid_until ?? ''}
                          key={`${b.id}-${b.valid_until ?? ''}-${resetN}`}
                          disabled={!act.editValidity || disabled}
                          onBlur={e => changeValidity(b, e.target.value)}
                          className="h-7 px-2 rounded-lg border border-linha text-xs bg-white disabled:bg-porcelana"
                        />
                      </label>
                      {b.status === 'sent' && <span className="text-[11px] text-[#B45309]">{SENT_EDIT_NOTICE}</span>}
                    </div>

                    <div className="divide-y divide-porcelana-2">
                      {items.map((item) => {
                        const ist = ITEM_STATUS[item.status]
                        return (
                          <div key={item.id} className="flex items-center gap-3 px-5 py-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-tinta">
                                {item.procedure}
                                {won && (
                                  <span className={`ml-2 text-[11px] font-semibold ${item.approved ? 'text-[#10B981]' : 'text-tinta-4'}`}>
                                    {item.approved ? 'Aprovado' : 'Não aprovado'}
                                  </span>
                                )}
                              </p>
                              <p className="text-xs text-tinta-3">
                                {item.tooth ? `Dente ${item.tooth} · ` : ''}
                                Qtd {item.quantity} · {formatCurrency(item.unit_price)} un.
                              </p>
                            </div>
                            <select
                              value={item.status}
                              onChange={e => updateItemStatus(b.id, item.id, e.target.value as BudgetItem['status'])}
                              className="h-7 px-2 rounded-lg border border-linha text-xs bg-white focus:outline-none"
                              style={{ color: ist.color }}
                            >
                              {Object.entries(ITEM_STATUS).map(([v, c]) => (
                                <option key={v} value={v}>{c.label}</option>
                              ))}
                            </select>
                            <p className="text-sm font-semibold text-tinta shrink-0 w-20 text-right">
                              {formatCurrency(item.unit_price * item.quantity)}
                            </p>
                          </div>
                        )
                      })}
                    </div>

                    {b.notes && (
                      <p className="px-5 py-3 text-xs text-tinta-3 italic border-t border-porcelana-2">{b.notes}</p>
                    )}

                    {msg && (
                      <div className={`px-5 py-2 text-xs border-t border-porcelana flex items-center gap-3 ${msg.kind === 'err' ? 'text-red-600 bg-red-50' : 'text-[#047857] bg-[#ECFDF5]'}`}>
                        <span>{msg.text}</span>
                        {msg.link && (
                          <button onClick={() => copyLink(b, msg.link)} className="underline font-medium">Copiar link</button>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-3 border-t border-porcelana bg-porcelana-2">
                      {act.send && (
                        <button disabled={disabled} onClick={() => send(b, false)} className={`${btn} bg-petroleo text-white hover:bg-petroleo-escuro`}>Enviar</button>
                      )}
                      {act.resend && (
                        <button disabled={disabled} onClick={() => send(b, true)} className={`${btn} bg-petroleo-50 text-petroleo hover:bg-petroleo-100`}>Reenviar</button>
                      )}
                      {act.copyLink && (
                        <button disabled={disabled} onClick={() => copyLink(b)} className={`${btn} bg-porcelana text-tinta-2 hover:bg-linha`}>Copiar link</button>
                      )}
                      {act.decide && (
                        <>
                          <button disabled={disabled} onClick={() => setDecisao({ budget: b, mode: 'approve' })} className={`${btn} bg-[#ECFDF5] text-[#10B981] hover:bg-[#D1FAE5]`}>Aprovou</button>
                          <button disabled={disabled} onClick={() => setDecisao({ budget: b, mode: 'lose' })} className={`${btn} bg-[#FEF2F2] text-[#EF4444] hover:bg-[#FEE2E2]`}>Perdido</button>
                        </>
                      )}
                      {act.reopen && (
                        <button disabled={disabled} onClick={() => reopen(b)} className={`${btn} bg-petroleo-50 text-petroleo hover:bg-petroleo-100`}>Reabrir</button>
                      )}
                      {act.receipt && (
                        <button onClick={() => openReceipt(b)} className={`${btn} bg-porcelana text-tinta-2 hover:bg-linha`}>Comprovante</button>
                      )}
                      {patient && act.charge && (
                        <button onClick={() => openCharge(b, remaining)} className={`${btn} bg-[#FFFBEB] text-[#B45309] hover:bg-[#FEF3C7]`}>Gerar cobrança</button>
                      )}
                      {patient && won && !act.charge && (
                        <span className="px-3 h-7 inline-flex items-center text-xs text-tinta-3">Cobrado integralmente</span>
                      )}
                      {act.complete && (
                        <button disabled={disabled} onClick={() => updateBudget(b, { status: 'completed' })} className={`${btn} bg-petroleo-50 text-petroleo hover:bg-petroleo-100`}>Concluído</button>
                      )}
                    </div>

                    <div className="px-5 py-3 border-t border-porcelana">
                      <p className="text-xs font-semibold text-tinta-3 mb-2">Histórico</p>
                      {(events[b.id] ?? []).length === 0 ? (
                        <p className="text-xs text-tinta-4">Sem eventos.</p>
                      ) : (
                        <ul className="space-y-1">
                          {(events[b.id] ?? []).map(e => (
                            <li key={e.id} className="text-xs text-tinta-2">
                              <span className="text-tinta-4">{format(parseISO(e.created_at), "d MMM yyyy HH:mm", { locale: ptBR })}</span>
                              {' · '}{eventLabel(e)}{e.note ? ` — ${e.note}` : ''}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {decisao && (
        <ModalDecisao
          budget={{ id: decisao.budget.id, items: decisao.budget.items }}
          mode={decisao.mode}
          onClose={() => setDecisao(null)}
          onDone={() => { setDecisao(null); load() }}
        />
      )}

      {chargeBudget && patient && (
        <ModalNovaCobranca
          patient={patient}
          budget={chargeBudget}
          onClose={() => setChargeBudget(null)}
          onCreated={() => { load() }}
        />
      )}

      {showModal && (
        <ModalNovoOrcamento
          patientId={patientId}
          clinicId={clinicId}
          professionalId={profs.find(p => p.user_id && p.user_id === userId)?.id ?? null}
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

function ModalNovoOrcamento({ patientId, clinicId, professionalId, onClose, onSaved }: {
  patientId: string; clinicId: string; professionalId: string | null; onClose: () => void; onSaved: () => void
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

    const { data: budget, error: bErr } = await supabase.from('budgets').insert({
      clinic_id: clinicId, patient_id: patientId, professional_id: professionalId,
      status: 'draft', notes: notes || null, total,
    }).select().single()
    if (bErr || !budget) { setSaving(false); setError(bErr?.message ?? 'Não foi possível criar o orçamento.'); return }

    const { error: iErr } = await supabase.from('budget_items').insert(
      valid.map(i => ({
        budget_id: budget.id,
        procedure: i.procedure.trim(),
        tooth: i.tooth || null,
        quantity: parseInt(i.quantity) || 1,
        unit_price: parseFloat(i.unit_price),
        status: 'pending',
      }))
    )
    if (iErr) { setSaving(false); setError(iErr.message); return }
    setSaving(false)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-xl mx-4 max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-linha shrink-0">
          <h2 className="text-base font-semibold text-tinta">Novo orçamento</h2>
          <button onClick={onClose} className="p-1 rounded text-tinta-4 hover:text-tinta-2">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="space-y-3">
            {items.map((item, idx) => (
              <div key={item.id} className="bg-porcelana-2 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-tinta-3">Procedimento {idx + 1}</p>
                  {items.length > 1 && (
                    <button onClick={() => setItems(prev => prev.filter(i => i.id !== item.id))}
                      className="p-1 rounded text-tinta-4 hover:text-red-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <input
                  value={item.procedure}
                  onChange={e => updateItem(item.id, { procedure: e.target.value })}
                  placeholder="Nome do procedimento"
                  className="w-full h-9 px-3 rounded-lg border border-linha text-sm bg-white focus:outline-none focus:ring-2 focus:ring-petroleo"
                />
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs text-tinta-3 mb-1">Dente</label>
                    <input value={item.tooth} onChange={e => updateItem(item.id, { tooth: e.target.value })}
                      placeholder="Ex: 36"
                      className="w-full h-9 px-3 rounded-lg border border-linha text-sm bg-white focus:outline-none focus:ring-2 focus:ring-petroleo" />
                  </div>
                  <div>
                    <label className="block text-xs text-tinta-3 mb-1">Qtd</label>
                    <input type="number" min="1" value={item.quantity} onChange={e => updateItem(item.id, { quantity: e.target.value })}
                      className="w-full h-9 px-3 rounded-lg border border-linha text-sm bg-white focus:outline-none focus:ring-2 focus:ring-petroleo" />
                  </div>
                  <div>
                    <label className="block text-xs text-tinta-3 mb-1">Valor un. (R$)</label>
                    <input type="number" step="0.01" min="0" value={item.unit_price} onChange={e => updateItem(item.id, { unit_price: e.target.value })}
                      placeholder="0,00"
                      className="w-full h-9 px-3 rounded-lg border border-linha text-sm bg-white focus:outline-none focus:ring-2 focus:ring-petroleo" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button onClick={() => setItems(prev => [...prev, newItem()])}
            className="w-full flex items-center justify-center gap-1.5 h-9 rounded-xl border border-dashed border-linha-forte text-sm text-tinta-3 hover:border-petroleo hover:text-petroleo transition-colors">
            <Plus className="w-4 h-4" /> Adicionar procedimento
          </button>

          <div>
            <label className="block text-sm font-medium text-tinta mb-1">Observações</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full px-3 py-2 rounded-lg border border-linha text-sm focus:outline-none focus:ring-2 focus:ring-petroleo resize-none" />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="p-5 border-t border-linha flex items-center gap-3 shrink-0">
          <div className="flex-1">
            <p className="text-xs text-tinta-3">Total</p>
            <p className="text-lg font-bold text-tinta">{formatCurrency(total)}</p>
          </div>
          <button onClick={onClose}
            className="h-10 px-4 rounded-lg border border-linha text-sm font-medium text-tinta-3 hover:bg-porcelana">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="h-10 px-6 rounded-lg bg-petroleo text-white text-sm font-medium hover:bg-petroleo-escuro disabled:opacity-50">
            {saving ? 'Salvando...' : 'Criar orçamento'}
          </button>
        </div>
      </div>
    </div>
  )
}
