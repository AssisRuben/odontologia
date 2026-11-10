'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import { formatCurrency } from '@/lib/utils'
import { splitInstallments, validateChargeInput, MAX_INSTALLMENTS } from '@/lib/payments/installments'
import { parseReaisInput } from '@/lib/payments/money'
import { normalizeCpf } from '@/lib/payments/cpf'
import { toDbPaidAt } from '@/lib/payments/dates'
import { PAYMENT_METHOD_LABELS } from '@/types'
import type { PaymentMethod } from '@/types'
import { errorText } from './errorText'

export interface NovaCobrancaPatient {
  id: string
  name: string
  cpf?: string | null
  whatsapp_opt_out?: boolean
}

interface Props {
  patient: NovaCobrancaPatient
  budget?: { id: string; total: number; label: string }
  onClose: () => void
  onCreated: () => void
}

type Mode = 'avulsa' | 'carne' | 'cartao_parcelado' | 'manual'

const MODES: { value: Mode; label: string }[] = [
  { value: 'avulsa', label: 'À vista' },
  { value: 'carne', label: 'Carnê' },
  { value: 'cartao_parcelado', label: 'Cartão parcelado' },
  { value: 'manual', label: 'Registrar sem link' },
]

function todayLocal(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function ddmm(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
}

const inputCls = 'w-full h-10 px-3 rounded-lg border border-linha text-sm bg-white focus:outline-none focus:ring-2 focus:ring-petroleo'

export function ModalNovaCobranca({ patient, budget, onClose, onCreated }: Props) {
  const { clinicId } = useClinicStore()
  const [today] = useState(todayLocal)
  const [asaasOk, setAsaasOk] = useState<boolean | undefined>(undefined)
  const [waConnected, setWaConnected] = useState<boolean | undefined>(undefined)
  const [mode, setMode] = useState<Mode | null>(null)
  const [amount, setAmount] = useState(budget ? String(budget.total.toFixed(2)).replace('.', ',') : '')
  const [description, setDescription] = useState(budget?.label ?? '')
  const [count, setCount] = useState(2)
  const [firstDue, setFirstDue] = useState(today)
  const [cpf, setCpf] = useState('')
  const [sendWa, setSendWa] = useState(true)
  const [method, setMethod] = useState<PaymentMethod>('dinheiro')
  const [received, setReceived] = useState(true)
  const [paidDate, setPaidDate] = useState(today)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const [notices, setNotices] = useState<string[] | null>(null)

  useEffect(() => {
    let active = true
    fetch('/api/payments/connection', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { connected?: boolean; status?: string } | null) => {
        if (active) setAsaasOk(Boolean(d?.connected && d.status === 'connected'))
      })
      .catch(() => { if (active) setAsaasOk(false) })
    fetch('/api/whatsapp/status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { status?: string } | null) => { if (active) setWaConnected(d?.status === 'connected') })
      .catch(() => { if (active) setWaConnected(false) })
    return () => { active = false }
  }, [])

  const effectiveMode: Mode = mode ?? (asaasOk ? 'avulsa' : 'manual')
  const isAsaas = effectiveMode !== 'manual'
  const installmentCount = effectiveMode === 'avulsa' || effectiveMode === 'manual' ? 1 : count
  const parsedCents = parseReaisInput(amount)
  const amountCents = parsedCents ?? 0
  const needCpf = isAsaas && !patient.cpf

  const waBlock = patient.whatsapp_opt_out
    ? 'Paciente optou por não receber WhatsApp'
    : waConnected === false ? 'WhatsApp desconectado' : null

  // Em "Registrar sem link" já recebido, a data pode ser passada; o resto valida como cobrança.
  const dueForValidation = effectiveMode === 'manual' && received ? today : firstDue
  const validation = useMemo(
    () => validateChargeInput({ amountCents, installmentCount, firstDueDate: dueForValidation, today }),
    [amountCents, installmentCount, dueForValidation, today],
  )
  const amountOnlyError = parsedCents === null ? 'Valor inválido' : effectiveMode === 'manual' && received
    ? (amountCents > 0 ? null : 'Informe um valor maior que zero')
    : validation
  const dateMissing = !(effectiveMode === 'manual' && received ? paidDate : firstDue)

  const summary = useMemo(() => {
    if (validation && amountCents <= 0) return ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDue) || amountCents <= 0) return ''
    const parts = splitInstallments(amountCents, installmentCount, firstDue)
    if (installmentCount === 1) return `${formatCurrency(amountCents / 100)} à vista · vencimento ${ddmm(firstDue)}`
    const last = parts[parts.length - 1]
    return `${installmentCount}x de ${formatCurrency(parts[0].amountCents / 100)} · vencimentos ${ddmm(firstDue)} a ${ddmm(last.dueDate)}`
  }, [amountCents, installmentCount, firstDue, validation])

  const canSubmit = !submitting && !amountOnlyError && !dateMissing && description.trim().length > 0 &&
    (effectiveMode !== 'manual' || !!clinicId) && (!isAsaas || asaasOk === true)

  async function handleSubmit() {
    if (inFlight.current) return
    inFlight.current = true
    setError('')
    if (needCpf && !normalizeCpf(cpf)) { setError('CPF inválido'); inFlight.current = false; return }
    setSubmitting(true)
    try {
      if (effectiveMode === 'manual') {
        const { error: dbErr } = await createClient().from('payments').insert({
          clinic_id: clinicId,
          patient_id: patient.id,
          amount: amountCents / 100,
          description: description.trim(),
          payment_method: method,
          status: received ? 'paid' : 'pending',
          ...(received ? { paid_at: toDbPaidAt(paidDate) } : { due_date: firstDue }),
          charge_kind: 'manual',
          ...(budget ? { budget_id: budget.id } : {}),
        })
        if (dbErr) { setError('Não foi possível registrar o pagamento. Tente novamente.'); return }
        onCreated()
        onClose()
        return
      }

      const res = await fetch('/api/payments/charges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: patient.id,
          ...(budget ? { budgetId: budget.id } : {}),
          amountCents,
          description: description.trim(),
          kind: effectiveMode,
          installmentCount,
          firstDueDate: firstDue,
          ...(needCpf ? { cpf: normalizeCpf(cpf) } : {}),
          sendWhatsApp: sendWa && !waBlock,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(errorText(res.status, data, 'Não foi possível criar a cobrança. Tente novamente.'))
        return
      }
      onCreated()
      const msgs: string[] = []
      if (data?.pending) msgs.push('Cobrança enviada ao Asaas; a confirmação pode levar alguns minutos')
      if (data?.whatsapp && data.whatsapp.ok === false) {
        msgs.push(`Cobrança criada, mas o link não foi enviado: ${data.whatsapp.error ?? 'erro desconhecido'}`)
      }
      if (msgs.length === 0) { onClose(); return }
      setNotices(msgs)
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
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-linha">
          <h2 className="text-base font-semibold text-tinta">Nova cobrança</h2>
          <button onClick={onClose} className="p-1 rounded text-tinta-4 hover:text-tinta-2" aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>

        {notices ? (
          <div className="p-5 space-y-4">
            {notices.map((n) => (
              <p key={n} role="status" className="text-sm text-tinta-2 bg-porcelana-2 border border-linha rounded-lg px-3 py-2">{n}</p>
            ))}
            <button type="button" onClick={onClose}
              className="w-full h-10 rounded-lg bg-petroleo text-white text-sm font-medium hover:bg-petroleo-escuro">
              Fechar
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <p className="text-sm text-tinta-3">Paciente: <span className="font-medium text-tinta">{patient.name}</span></p>

            <div>
              <label className="block text-sm font-medium text-tinta mb-1">Forma</label>
              <div className="grid grid-cols-2 gap-2">
                {MODES.map((m) => {
                  const disabled = m.value !== 'manual' && asaasOk !== true
                  const active = effectiveMode === m.value
                  return (
                    <button key={m.value} type="button" disabled={disabled} onClick={() => setMode(m.value)}
                      className={`h-10 rounded-lg border text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                        active ? 'border-petroleo bg-petroleo-50 text-petroleo' : 'border-linha text-tinta-2 hover:bg-porcelana'
                      }`}>
                      {m.label}
                    </button>
                  )
                })}
              </div>
              {asaasOk === false && (
                <p className="text-xs text-tinta-3 mt-1.5">
                  Asaas não conectado.{' '}
                  <Link href="/configuracoes/pagamentos" className="font-medium text-petroleo underline">Conectar o Asaas</Link>
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="nc-valor" className="block text-sm font-medium text-tinta mb-1">Valor total (R$)</label>
                <input id="nc-valor" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
                  placeholder="0,00" className={inputCls} />
              </div>
              {(effectiveMode === 'carne' || effectiveMode === 'cartao_parcelado') && (
                <div>
                  <label htmlFor="nc-parcelas" className="block text-sm font-medium text-tinta mb-1">Parcelas</label>
                  <input id="nc-parcelas" type="number" min={2} max={MAX_INSTALLMENTS} value={count}
                    onChange={(e) => setCount(Math.floor(Number(e.target.value)) || 0)} className={inputCls} />
                </div>
              )}
            </div>

            <div>
              <label htmlFor="nc-desc" className="block text-sm font-medium text-tinta mb-1">Descrição</label>
              <input id="nc-desc" value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
            </div>

            {effectiveMode === 'manual' && (
              <>
                <div>
                  <label htmlFor="nc-metodo" className="block text-sm font-medium text-tinta mb-1">Forma de pagamento</label>
                  <select id="nc-metodo" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={inputCls}>
                    {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((k) => (
                      <option key={k} value={k}>{PAYMENT_METHOD_LABELS[k]}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-4 text-sm text-tinta-2">
                  <label className="flex items-center gap-1.5">
                    <input type="radio" checked={received} onChange={() => setReceived(true)} /> Já recebido
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="radio" checked={!received} onChange={() => setReceived(false)} /> A receber
                  </label>
                </div>
              </>
            )}

            <div>
              <label htmlFor="nc-data" className="block text-sm font-medium text-tinta mb-1">
                {effectiveMode === 'manual' && received ? 'Data do pagamento'
                  : installmentCount > 1 ? 'Primeiro vencimento' : 'Vencimento'}
              </label>
              {effectiveMode === 'manual' && received ? (
                <input id="nc-data" type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} className={inputCls} />
              ) : (
                <input id="nc-data" type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} className={inputCls} />
              )}
            </div>

            {needCpf && (
              <div>
                <label htmlFor="nc-cpf" className="block text-sm font-medium text-tinta mb-1">CPF do paciente</label>
                <input id="nc-cpf" inputMode="numeric" value={cpf} onChange={(e) => setCpf(e.target.value)}
                  placeholder="000.000.000-00" className={inputCls} />
              </div>
            )}

            {isAsaas && (
              <div>
                <label className={`flex items-center gap-2 text-sm ${waBlock ? 'text-tinta-4' : 'text-tinta-2'}`}>
                  <input type="checkbox" checked={!waBlock && sendWa} disabled={!!waBlock}
                    onChange={(e) => setSendWa(e.target.checked)} />
                  Enviar link agora pelo WhatsApp
                </label>
                {waBlock && <p className="text-xs text-tinta-3 mt-1 ml-6">{waBlock}</p>}
              </div>
            )}

            {summary && !amountOnlyError && (
              <p className="text-sm text-tinta-2 bg-porcelana-2 border border-linha rounded-lg px-3 py-2">{summary}</p>
            )}
            {amountOnlyError && amount.trim() !== '' && (
              <p className="text-sm text-red-600">{amountOnlyError}</p>
            )}
            {error && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

            <div className="flex gap-3">
              <button type="button" onClick={onClose} disabled={submitting}
                className="flex-1 h-10 rounded-lg border border-linha text-sm font-medium text-tinta-3 hover:bg-porcelana disabled:opacity-50">
                {budget ? 'Cobrar depois' : 'Cancelar'}
              </button>
              <button type="button" onClick={handleSubmit} disabled={!canSubmit}
                className="flex-1 h-10 rounded-lg bg-petroleo text-white text-sm font-medium hover:bg-petroleo-escuro disabled:opacity-50">
                {submitting ? 'Enviando...' : effectiveMode === 'manual' ? 'Registrar' : 'Criar cobrança'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
