'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Paperclip, Plus, Repeat } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import { formatCurrency } from '@/lib/utils'
import type { Expense } from '@/types'
import { categoryLabel } from '@/lib/livro-caixa/categorias'
import { monthLabel, monthRange, shiftMonth } from '@/lib/livro-caixa/mes'
import { checkReceiptFile, RECEIPT_TYPES } from '@/lib/livro-caixa/despesas'
import { fromDbPaidAt, toDbPaidAt } from '@/lib/payments/dates'
import { mesDe, rotuloMes } from '@/lib/fluxo/recorrencia'
import { signedUrls } from '@/lib/storage/documentos'
import { ModalDespesa, RECEIPT_BUCKET, RECEIPT_FAILED_MSG, attachReceipt, todayLocal } from './ModalDespesa'

function ddmmyyyy(iso: string | null | undefined): string {
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—'
}

export default function ListaDespesas() {
  const { clinicId } = useClinicStore()
  const [month, setMonth] = useState(() => todayLocal().slice(0, 7))
  const [items, setItems] = useState<Expense[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [error, setError] = useState('')
  const [modal, setModal] = useState<{ expense?: Expense } | null>(null)
  const [payingId, setPayingId] = useState<string | null>(null)
  const [payDate, setPayDate] = useState(todayLocal)
  const [busyId, setBusyId] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const attachTarget = useRef<Expense | null>(null)

  function changeMonth(m: string) {
    setLoading(true)
    setMonth(m)
  }

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    if (!clinicId) return
    let stale = false
    async function load() {
      const supabase = createClient()
      const { first, last } = monthRange(month)
      try {
        const [paidRes, pendingRes] = await Promise.all([
          supabase.from('expenses').select('*').eq('clinic_id', clinicId!).eq('status', 'paid')
            .gte('paid_at', `${first}T00:00:00Z`).lte('paid_at', `${last}T23:59:59Z`),
          supabase.from('expenses').select('*').eq('clinic_id', clinicId!).neq('status', 'paid')
            .gte('due_date', first).lte('due_date', last),
        ])
        if (stale) return
        if (paidRes.error || pendingRes.error) {
          setError('Não foi possível carregar as despesas. Tente novamente.')
          return
        }
        const rows = [...(paidRes.data ?? []), ...(pendingRes.data ?? [])] as Expense[]
        const dateOf = (e: Expense) => (e.status === 'paid' ? fromDbPaidAt(e.paid_at ?? null) : e.due_date?.slice(0, 10)) ?? ''
        rows.sort((a, b) => dateOf(a).localeCompare(dateOf(b)))
        const paths = rows.map((e) => e.receipt_path).filter((p): p is string => !!p)
        const map = await signedUrls(supabase, RECEIPT_BUCKET, paths)
        if (stale) return
        setItems(rows)
        setUrls(map)
        setError('')
      } finally {
        if (!stale) setLoading(false)
      }
    }
    load()
    return () => { stale = true }
  }, [clinicId, month, reloadKey])

  // gera as despesas recorrentes que faltam e recarrega se algo foi criado
  useEffect(() => {
    if (!clinicId) return
    let cancelled = false
    fetch('/api/financeiro/recorrencias/gerar', { method: 'POST' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { criadas?: number } | null) => { if (!cancelled && json && (json.criadas ?? 0) > 0) reload() })
      .catch(() => {})
    return () => { cancelled = true }
  }, [clinicId, reload])

  async function encerrar(e: Expense) {
    if (!e.recurrence_id || !e.recurrence_month) return
    if (!window.confirm(`Encerrar após ${rotuloMes(mesDe(e.recurrence_month))}? As próximas ainda não pagas serão apagadas.`)) return
    setBusyId(e.id)
    setError('')
    try {
      const res = await fetch(`/api/financeiro/recorrencias/${e.recurrence_id}/encerrar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ultimoMes: mesDe(e.recurrence_month) }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null) as { error?: string } | null
        setError(json?.error ?? 'Não foi possível encerrar a recorrência. Tente novamente.')
        return
      }
      reload()
    } catch {
      setError('Não foi possível encerrar a recorrência. Tente novamente.')
    } finally {
      setBusyId(null)
    }
  }

  async function markPaid(e: Expense) {
    if (!clinicId || !payDate) return
    setBusyId(e.id)
    setError('')
    const { error: dbErr } = await createClient().from('expenses').update({
      status: 'paid',
      paid_at: toDbPaidAt(payDate),
      updated_at: new Date().toISOString(),
    }).eq('id', e.id).eq('clinic_id', clinicId)
    setBusyId(null)
    if (dbErr) { setError('Não foi possível marcar como paga. Tente novamente.'); return }
    setPayingId(null)
    reload()
  }

  async function remove(e: Expense) {
    if (!clinicId) return
    if (!window.confirm(`Excluir a despesa "${e.description}"?`)) return
    setBusyId(e.id)
    setError('')
    const supabase = createClient()
    try {
      if (e.receipt_path) {
        const { error: stErr } = await supabase.storage.from(RECEIPT_BUCKET).remove([e.receipt_path])
        if (stErr && !/not.?found/i.test(stErr.message)) {
          setError('Não foi possível excluir o comprovante. Tente novamente.')
          return
        }
      }
      const { error: dbErr } = await supabase.from('expenses').delete().eq('id', e.id).eq('clinic_id', clinicId)
      if (dbErr) { setError('Não foi possível excluir a despesa. Tente novamente.'); return }
      reload()
    } finally {
      setBusyId(null)
    }
  }

  async function onFilePicked(f: File | null) {
    const target = attachTarget.current
    attachTarget.current = null
    if (fileInput.current) fileInput.current.value = ''
    if (!f || !target || !clinicId) return
    const err = checkReceiptFile(f)
    if (err) { setError(err); return }
    setBusyId(target.id)
    setError('')
    const ok = await attachReceipt(createClient(), clinicId, target, f)
    setBusyId(null)
    if (!ok) setError(RECEIPT_FAILED_MSG)
    reload()
  }

  const total = items.reduce((s, e) => s + e.amount, 0)

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => changeMonth(shiftMonth(month, -1))} aria-label="Mês anterior"
            className="p-1.5 rounded-lg hover:bg-porcelana text-tinta-3">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-base font-semibold text-tinta capitalize w-44 text-center">{monthLabel(month)}</span>
          <button onClick={() => changeMonth(shiftMonth(month, 1))} aria-label="Próximo mês"
            className="p-1.5 rounded-lg hover:bg-porcelana text-tinta-3">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <button onClick={() => setModal({})}
          className="flex items-center gap-1.5 h-10 px-4 rounded-lg bg-petroleo text-white text-sm font-medium hover:bg-petroleo-escuro">
          <Plus className="w-4 h-4" /> Nova despesa
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      <input ref={fileInput} type="file" className="hidden" accept={RECEIPT_TYPES.join(',')}
        onChange={(e) => onFilePicked(e.target.files?.[0] ?? null)} />

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-petroleo border-t-transparent rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-tinta-4 text-sm">Nenhuma despesa neste mês.</div>
      ) : (
        <div className="bg-white rounded-xl border border-linha overflow-hidden divide-y divide-porcelana">
          {items.map((e) => {
            const paid = e.status === 'paid'
            const busy = busyId === e.id
            const link = e.receipt_path ? urls[e.receipt_path] : undefined
            return (
              <div key={e.id} className="px-4 py-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-tinta flex items-center gap-1.5">
                      <span className="truncate">{e.description}</span>
                      {e.recurrence_id && <span title="Despesa recorrente" className="shrink-0"><Repeat className="w-3.5 h-3.5 text-tinta-3" aria-label="Despesa recorrente" /></span>}
                      {e.receipt_path && <Paperclip className="w-3.5 h-3.5 text-tinta-3 shrink-0" aria-label="Tem comprovante" />}
                    </p>
                    <p className="text-xs text-tinta-4">
                      {categoryLabel(e.category)} · {paid ? `Paga em ${ddmmyyyy(fromDbPaidAt(e.paid_at ?? null))}` : `Vence ${ddmmyyyy(e.due_date)}`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-tinta">{formatCurrency(e.amount)}</p>
                    <span className={`text-xs font-medium ${paid ? 'text-[#10B981]' : 'text-[#F59E0B]'}`}>
                      {paid ? 'Paga' : 'A pagar'}
                    </span>
                  </div>
                </div>

                {payingId === e.id ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <label htmlFor={`pay-${e.id}`} className="text-tinta-3">Data do pagamento</label>
                    <input id={`pay-${e.id}`} type="date" value={payDate} onChange={(ev) => setPayDate(ev.target.value)}
                      className="h-9 px-2 rounded-lg border border-linha text-sm" />
                    <button onClick={() => markPaid(e)} disabled={busy || !payDate}
                      className="h-9 px-3 rounded-lg bg-petroleo text-white font-medium hover:bg-petroleo-escuro disabled:opacity-50">
                      Confirmar
                    </button>
                    <button onClick={() => setPayingId(null)} className="h-9 px-3 rounded-lg border border-linha text-tinta-3 hover:bg-porcelana">
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-petroleo">
                    {!paid && (
                      <button disabled={busy} onClick={() => { setPayDate(todayLocal()); setPayingId(e.id) }}
                        className="hover:underline disabled:opacity-50">Marcar como paga</button>
                    )}
                    <button disabled={busy} onClick={() => setModal({ expense: e })} className="hover:underline disabled:opacity-50">Editar</button>
                    <button disabled={busy} onClick={() => { attachTarget.current = e; fileInput.current?.click() }}
                      className="hover:underline disabled:opacity-50">
                      {e.receipt_path ? 'Trocar comprovante' : 'Anexar comprovante'}
                    </button>
                    {link && (
                      <a href={link} target="_blank" rel="noopener noreferrer" className="hover:underline">Ver comprovante</a>
                    )}
                    {e.recurrence_id && (
                      <button disabled={busy} onClick={() => encerrar(e)} className="hover:underline disabled:opacity-50">Encerrar recorrência</button>
                    )}
                    <button disabled={busy} onClick={() => remove(e)} className="text-[#EF4444] hover:underline disabled:opacity-50">Excluir</button>
                  </div>
                )}
              </div>
            )
          })}
          <div className="px-4 py-3 flex justify-between text-sm">
            <span className="text-tinta-3">Total do mês</span>
            <span className="font-bold text-tinta">{formatCurrency(total)}</span>
          </div>
        </div>
      )}

      {modal && (
        <ModalDespesa expense={modal.expense} onClose={() => setModal(null)} onSaved={reload} />
      )}
    </div>
  )
}
