'use client'

import { useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import { PAYMENT_METHOD_LABELS } from '@/types'
import type { DeductionGroup, Expense, ExpenseCategory, PaymentMethod } from '@/types'
import { CATEGORIES, defaultGroup, groupLabel, toCategory } from '@/lib/livro-caixa/categorias'
import {
  RECEIPT_TYPES, checkReceiptFile, receiptStoragePath, validateExpense,
  type ExpenseForm,
} from '@/lib/livro-caixa/despesas'
import { fromDbPaidAt } from '@/lib/payments/dates'
import { parseReaisInput } from '@/lib/payments/money'
import { diaDe, mesDe } from '@/lib/fluxo/recorrencia'

export const RECEIPT_BUCKET = 'expense-receipts'
export const RECEIPT_FAILED_MSG = 'Comprovante não enviado. Tente anexar de novo.'

const EXPENSE_METHODS: PaymentMethod[] = ['dinheiro', 'cartao_credito', 'cartao_debito', 'pix', 'boleto']
const GROUPS: DeductionGroup[] = ['custeio', 'pessoal', 'emolumentos']

const inputCls = 'w-full h-10 px-3 rounded-lg border border-linha text-sm bg-white focus:outline-none focus:ring-2 focus:ring-petroleo'

export function todayLocal(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Sobe o comprovante, grava receipt_* e só então apaga o arquivo antigo. Devolve false se falhar. */
export async function attachReceipt(
  supabase: SupabaseClient,
  clinicId: string,
  expense: { id: string; receipt_path?: string | null },
  file: File,
): Promise<boolean> {
  const path = receiptStoragePath(clinicId, expense.id, file.name, crypto.randomUUID())
  const up = await supabase.storage.from(RECEIPT_BUCKET).upload(path, file, { contentType: file.type })
  if (up.error) return false
  const { error } = await supabase.from('expenses').update({
    receipt_path: path,
    receipt_name: file.name,
    receipt_size: file.size,
    receipt_type: file.type,
    updated_at: new Date().toISOString(),
  }).eq('id', expense.id).eq('clinic_id', clinicId)
  if (error) {
    await supabase.storage.from(RECEIPT_BUCKET).remove([path])
    return false
  }
  if (expense.receipt_path) await supabase.storage.from(RECEIPT_BUCKET).remove([expense.receipt_path])
  return true
}

/** Chama a API de recorrências. Devolve a mensagem de erro, ou null se deu certo. */
async function chamarRecorrencia(url: string, method: 'POST' | 'PATCH', body: unknown): Promise<string | null> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (res.ok) return null
  const json = await res.json().catch(() => null) as { error?: string } | null
  return json?.error ?? 'Não foi possível salvar a despesa. Tente novamente.'
}

interface Props {
  expense?: Expense
  onClose: () => void
  onSaved: () => void
}

function initialForm(e?: Expense): ExpenseForm {
  if (!e) {
    return {
      description: '', amount: '', category: 'outras', deductionGroup: defaultGroup('outras'),
      dueDate: todayLocal(), paid: false, paidDate: todayLocal(), paymentMethod: '', professionalId: '', notes: '',
    }
  }
  const category: ExpenseCategory = toCategory(e.category)
  return {
    description: e.description,
    amount: e.amount.toFixed(2).replace('.', ','),
    category,
    deductionGroup: e.deduction_group ?? null,
    dueDate: e.due_date?.slice(0, 10) ?? '',
    paid: e.status === 'paid',
    paidDate: fromDbPaidAt(e.paid_at ?? null) ?? todayLocal(),
    paymentMethod: e.payment_method ?? '',
    professionalId: e.professional_id ?? '',
    notes: e.notes ?? '',
  }
}

export function ModalDespesa({ expense, onClose, onSaved }: Props) {
  const { clinicId } = useClinicStore()
  const [form, setForm] = useState<ExpenseForm>(() => initialForm(expense))
  const [errors, setErrors] = useState<Partial<Record<keyof ExpenseForm, string>>>({})
  const [professionals, setProfessionals] = useState<{ id: string; name: string }[]>([])
  const [editGroup, setEditGroup] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [repeat, setRepeat] = useState(false)
  const [repDay, setRepDay] = useState<string | null>(null) // null = acompanha o dia do vencimento
  const [repUntil, setRepUntil] = useState('')
  const [askScope, setAskScope] = useState(false)
  // despesa já gravada nesta janela (se o comprovante falhar, salvar de novo atualiza em vez de duplicar)
  const savedRef = useRef<{ id: string; receipt_path?: string | null } | null>(expense ?? null)
  const inFlight = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!clinicId) return
    let active = true
    createClient().from('professionals').select('id, name').eq('clinic_id', clinicId).order('name')
      .then(({ data }) => { if (active) setProfessionals(data ?? []) })
    return () => { active = false }
  }, [clinicId])

  function set<K extends keyof ExpenseForm>(key: K, value: ExpenseForm[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function onPickFile(f: File | null) {
    if (!f) { setFile(null); setFileError(''); return }
    const err = checkReceiptFile(f)
    setFileError(err ?? '')
    setFile(err ? null : f)
  }

  const canRepeat = !expense && !form.paid
  const repeating = repeat && canRepeat
  const repDayValue = repDay ?? (form.dueDate ? String(diaDe(form.dueDate)) : '')

  async function handleSubmit(scope?: 'one' | 'following') {
    if (inFlight.current || !clinicId) return
    setError('')
    const result = validateExpense(form)
    if (!result.ok) { setAskScope(false); setErrors(result.errors); return }
    setErrors({})
    if (expense?.recurrence_id && !scope) { setAskScope(true); return }
    setAskScope(false)
    const cents = parseReaisInput(form.amount) as number
    const camposRecorrencia = {
      description: result.row.description,
      amountCentavos: cents,
      category: form.category,
      deductionGroup: form.deductionGroup,
      paymentMethod: form.paymentMethod || null,
    }
    if (repeating) {
      const dia = Number(repDayValue)
      if (!Number.isInteger(dia) || dia < 1 || dia > 31) { setErrors({ dueDate: 'Dia do vencimento inválido' }); return }
    }
    inFlight.current = true
    setSubmitting(true)
    try {
      const supabase = createClient()
      if (repeating) {
        const msg = await chamarRecorrencia('/api/financeiro/recorrencias', 'POST', {
          ...camposRecorrencia,
          dayOfMonth: Number(repDayValue),
          startMonth: mesDe(form.dueDate),
          endMonth: repUntil || null,
        })
        if (msg) { setError(msg); return }
        onSaved()
        onClose()
        return
      }
      let saved = savedRef.current
      const seguintes = scope === 'following' && expense?.recurrence_id && expense.recurrence_month
      if (seguintes) {
        if (!form.dueDate) { setErrors({ dueDate: 'Informe o vencimento' }); return }
        let dayOfMonth = diaDe(form.dueDate)
        if (form.dueDate === expense.due_date?.slice(0, 10)) {
          // vencimento intacto: mantém o dia guardado na recorrência (o da despesa pode estar ajustado ao mês curto)
          const { data: rec, error: recErr } = await supabase.from('expense_recurrences')
            .select('day_of_month').eq('id', expense.recurrence_id!).eq('clinic_id', clinicId).single()
          if (recErr || !rec) { setError('Não foi possível ler a recorrência. Tente novamente.'); return }
          dayOfMonth = Number(rec.day_of_month)
        }
        const msg = await chamarRecorrencia(`/api/financeiro/recorrencias/${expense.recurrence_id}`, 'PATCH', {
          ...camposRecorrencia,
          dayOfMonth,
          aPartirDe: mesDe(expense.recurrence_month!),
        })
        if (msg) { setError(msg); return }
        saved = { id: expense.id, receipt_path: expense.receipt_path }
      }
      if (saved) {
        const { error: dbErr } = await supabase.from('expenses')
          .update({ ...result.row, updated_at: new Date().toISOString() })
          .eq('id', saved.id).eq('clinic_id', clinicId)
        if (dbErr) { setError('Não foi possível salvar a despesa. Tente novamente.'); return }
      } else {
        const { data, error: dbErr } = await supabase.from('expenses')
          .insert({ ...result.row, clinic_id: clinicId }).select('id').single()
        if (dbErr || !data) { setError('Não foi possível salvar a despesa. Tente novamente.'); return }
        saved = { id: data.id as string, receipt_path: null }
        savedRef.current = saved
      }
      if (file) {
        const ok = await attachReceipt(supabase, clinicId, saved, file)
        if (!ok) {
          // a despesa fica salva; o usuário anexa de novo
          onSaved()
          setFile(null)
          if (fileRef.current) fileRef.current.value = ''
          setError(RECEIPT_FAILED_MSG)
          return
        }
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

  const fieldErr = (k: keyof ExpenseForm) =>
    errors[k] ? <p className="text-xs text-red-600 mt-1">{errors[k]}</p> : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={submitting ? undefined : onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-linha">
          <h2 className="text-base font-semibold text-tinta">{expense ? 'Editar despesa' : 'Nova despesa'}</h2>
          <button onClick={onClose} className="p-1 rounded text-tinta-4 hover:text-tinta-2" aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label htmlFor="dp-desc" className="block text-sm font-medium text-tinta mb-1">Descrição</label>
            <input id="dp-desc" value={form.description} onChange={(e) => set('description', e.target.value)} className={inputCls} />
            {fieldErr('description')}
          </div>

          <div>
            <label htmlFor="dp-valor" className="block text-sm font-medium text-tinta mb-1">Valor (R$)</label>
            <input id="dp-valor" inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value)}
              placeholder="0,00" className={inputCls} />
            {fieldErr('amount')}
          </div>

          <div>
            <label htmlFor="dp-cat" className="block text-sm font-medium text-tinta mb-1">Categoria</label>
            <select id="dp-cat" value={form.category}
              onChange={(e) => {
                const c = e.target.value as ExpenseCategory
                setForm((f) => ({ ...f, category: c, deductionGroup: defaultGroup(c) }))
              }}
              className={inputCls}>
              {CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
            {form.category === 'tarifas' && (
              <p className="text-xs text-[#92400E] mt-1.5">As tarifas do Asaas já entram sozinhas no livro-caixa. Lance aqui só tarifas de outros bancos.</p>
            )}
            <div className="text-xs text-tinta-3 mt-1.5">
              {editGroup ? (
                <select aria-label="Grupo do Carnê-Leão" value={form.deductionGroup ?? ''}
                  onChange={(e) => set('deductionGroup', (e.target.value || null) as DeductionGroup | null)}
                  className={inputCls}>
                  {GROUPS.map((g) => <option key={g} value={g}>{groupLabel(g)}</option>)}
                  <option value="">{groupLabel(null)}</option>
                </select>
              ) : (
                <>
                  Grupo no Carnê-Leão: <span className="font-medium text-tinta-2">{groupLabel(form.deductionGroup)}</span>{' '}
                  <button type="button" onClick={() => setEditGroup(true)} className="font-medium text-petroleo underline">alterar</button>
                </>
              )}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-tinta-2">
            <input type="checkbox" checked={form.paid} onChange={(e) => set('paid', e.target.checked)} />
            Já foi paga
          </label>

          {!expense && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-tinta-2">
                <input type="checkbox" checked={repeating} disabled={form.paid}
                  onChange={(e) => {
                    setRepeat(e.target.checked)
                    if (e.target.checked) onPickFile(null)
                    if (e.target.checked && fileRef.current) fileRef.current.value = ''
                  }} />
                Repete todo mês
              </label>
              {repeating && form.category === 'laboratorio' && (
                <p className="text-xs text-tinta-3">Despesas recorrentes não ficam ligadas a um dentista (não descontam da comissão).</p>
              )}
              {form.paid && (
                <p className="text-xs text-tinta-3">Para repetir todo mês, desmarque &quot;Já foi paga&quot;.</p>
              )}
              {repeating && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="dp-rep-dia" className="block text-sm font-medium text-tinta mb-1">Dia do vencimento</label>
                    <input id="dp-rep-dia" type="number" min={1} max={31} value={repDayValue}
                      onChange={(e) => setRepDay(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="dp-rep-ate" className="block text-sm font-medium text-tinta mb-1">Até (opcional)</label>
                    <input id="dp-rep-ate" type="month" value={repUntil}
                      onChange={(e) => setRepUntil(e.target.value)} className={inputCls} />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="dp-venc" className="block text-sm font-medium text-tinta mb-1">Vencimento</label>
              <input id="dp-venc" type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} className={inputCls} />
              {fieldErr('dueDate')}
            </div>
            {form.paid && (
              <div>
                <label htmlFor="dp-pago" className="block text-sm font-medium text-tinta mb-1">Data do pagamento</label>
                <input id="dp-pago" type="date" value={form.paidDate} onChange={(e) => set('paidDate', e.target.value)} className={inputCls} />
                {fieldErr('paidDate')}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="dp-metodo" className="block text-sm font-medium text-tinta mb-1">Forma de pagamento</label>
              <select id="dp-metodo" value={form.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value)} className={inputCls}>
                <option value="">Não informada</option>
                {EXPENSE_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
              </select>
            </div>
            {!repeating && (
              <div>
                <label htmlFor="dp-prof" className="block text-sm font-medium text-tinta mb-1">Dentista (opcional)</label>
                <select id="dp-prof" value={form.professionalId} onChange={(e) => set('professionalId', e.target.value)} className={inputCls}>
                  <option value="">Nenhum</option>
                  {professionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
          </div>

          {!repeating && (
          <div>
            <label htmlFor="dp-file" className="block text-sm font-medium text-tinta mb-1">
              {expense?.receipt_path ? 'Trocar comprovante' : 'Comprovante'}
            </label>
            <input id="dp-file" ref={fileRef} type="file" accept={RECEIPT_TYPES.join(',')}
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-tinta-2" />
            {fileError && <p className="text-xs text-red-600 mt-1">{fileError}</p>}
          </div>
          )}

          {!repeating && (
          <div>
            <label htmlFor="dp-obs" className="block text-sm font-medium text-tinta mb-1">Observação</label>
            <textarea id="dp-obs" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-linha text-sm bg-white focus:outline-none focus:ring-2 focus:ring-petroleo" />
          </div>
          )}

          {error && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          {askScope ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-tinta">Esta despesa se repete todo mês. O que alterar?</p>
              <div className="flex gap-3">
                <button type="button" onClick={() => handleSubmit('one')} disabled={submitting}
                  className="flex-1 h-10 rounded-lg border border-petroleo text-petroleo text-sm font-medium hover:bg-porcelana disabled:opacity-50">
                  Alterar só esta
                </button>
                <button type="button" onClick={() => handleSubmit('following')} disabled={submitting}
                  className="flex-1 h-10 rounded-lg bg-petroleo text-white text-sm font-medium hover:bg-petroleo-escuro disabled:opacity-50">
                  Esta e as próximas
                </button>
              </div>
              <button type="button" onClick={() => setAskScope(false)} disabled={submitting}
                className="w-full h-9 text-sm text-tinta-3 hover:underline">Voltar</button>
            </div>
          ) : (
          <div className="flex gap-3">
            <button type="button" onClick={onClose} disabled={submitting}
              className="flex-1 h-10 rounded-lg border border-linha text-sm font-medium text-tinta-3 hover:bg-porcelana disabled:opacity-50">
              {error === RECEIPT_FAILED_MSG ? 'Fechar' : 'Cancelar'}
            </button>
            <button type="button" onClick={() => handleSubmit()} disabled={submitting || !clinicId}
              className="flex-1 h-10 rounded-lg bg-petroleo text-white text-sm font-medium hover:bg-petroleo-escuro disabled:opacity-50">
              {submitting ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
          )}
        </div>
      </div>
    </div>
  )
}
