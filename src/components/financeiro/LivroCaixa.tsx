'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Copy, Download } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { fromCents } from '@/lib/payments/money'
import { formatCpf } from '@/lib/payments/cpf'
import { monthLabel, shiftMonth } from '@/lib/livro-caixa/mes'
import { DISCLAIMER } from '@/lib/livro-caixa/textos'
import type { Ledger, ReceiptItem } from '@/lib/livro-caixa/apuracao'

const OMITTED_MSG = 'Os comprovantes passam de 100 MB e ficaram fora do pacote.'

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function ddmmyyyy(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

function moneyText(cents: number): string {
  return fromCents(cents).toFixed(2).replace('.', ',')
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  try {
    const j = await res.json()
    return typeof j?.error === 'string' ? j.error : fallback
  } catch {
    return fallback
  }
}

function Line({ label, value, strong, sub }: { label: string; value: number; strong?: boolean; sub?: boolean }) {
  return (
    <div className={`flex justify-between text-sm ${sub ? 'pl-4' : ''}`}>
      <span className="text-[#6B7280]">{label}</span>
      <span className={strong ? 'font-bold text-[#111827]' : 'font-medium text-[#374151]'}>{formatCurrency(fromCents(value))}</span>
    </div>
  )
}

export default function LivroCaixa({ onOpenDespesas }: { onOpenDespesas: () => void }) {
  const [month, setMonth] = useState(currentMonth)
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [onlyPending, setOnlyPending] = useState(false)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const receiptsRef = useRef<HTMLDivElement>(null)
  const [downloading, setDownloading] = useState(false)
  const [copied, setCopied] = useState('')

  useEffect(() => {
    let stale = false
    async function load() {
      try {
        const res = await fetch(`/api/livro-caixa/${month}`)
        if (stale) return
        if (!res.ok) { setError(await errorOf(res, 'Não foi possível carregar o livro-caixa.')); setLedger(null); return }
        const data = (await res.json()) as Ledger
        if (stale) return
        setLedger(data)
        setError('')
      } catch {
        if (!stale) { setError('Não foi possível carregar o livro-caixa.'); setLedger(null) }
      } finally {
        if (!stale) setLoading(false)
      }
    }
    load()
    return () => { stale = true }
  }, [month])

  function changeMonth(m: string) {
    setLoading(true)
    setNotice('')
    setError('')
    setMonth(m)
  }

  function setIssued(paymentId: string, issuedAt: string | null) {
    setLedger((l) => l && {
      ...l,
      receipts: l.receipts.map((r) => (r.paymentId === paymentId ? { ...r, issuedAt } : r)),
    })
  }

  async function toggleIssued(r: ReceiptItem) {
    const wasIssued = !!r.issuedAt
    setBusyIds((b) => new Set(b).add(r.paymentId))
    setError('')
    setIssued(r.paymentId, wasIssued ? null : new Date().toISOString())
    try {
      const res = await fetch(`/api/livro-caixa/recibos/${r.paymentId}`, { method: wasIssued ? 'DELETE' : 'POST' })
      if (!res.ok) {
        setIssued(r.paymentId, r.issuedAt)
        setError(await errorOf(res, 'Não foi possível atualizar o recibo.'))
      }
    } catch {
      setIssued(r.paymentId, r.issuedAt)
      setError('Não foi possível atualizar o recibo.')
    } finally {
      setBusyIds((b) => { const n = new Set(b); n.delete(r.paymentId); return n })
    }
  }

  function showPendingReceipts() {
    setOnlyPending(true)
    receiptsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? '' : c)), 1500)
    } catch {
      setError('Não foi possível copiar.')
    }
  }

  async function download() {
    setDownloading(true)
    setError('')
    setNotice('')
    try {
      const res = await fetch(`/api/livro-caixa/${month}/exportar`)
      if (!res.ok) { setError(await errorOf(res, 'Não foi possível gerar o pacote.')); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `livro-caixa-${month}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      if (res.headers.get('X-Comprovantes-Omitidos')) setNotice(OMITTED_MSG)
    } catch {
      setError('Não foi possível gerar o pacote.')
    } finally {
      setDownloading(false)
    }
  }

  const t = ledger?.totals
  const alerts = ledger?.alerts
  const receipts = (ledger?.receipts ?? []).filter((r) => !onlyPending || !r.issuedAt)
  const alertLines = alerts ? [
    alerts.pendingReceipts > 0 && { text: `${alerts.pendingReceipts} recibo(s) do Receita Saúde pendente(s)`, target: 'recibos' as const },
    alerts.receiptsWithoutCpf > 0 && { text: `${alerts.receiptsWithoutCpf} pagamento(s) sem CPF do pagador`, target: 'recibos' as const },
    alerts.deductibleWithoutAttachment > 0 && { text: `${alerts.deductibleWithoutAttachment} despesa(s) dedutível(is) sem comprovante`, target: 'despesas' as const },
  ].filter((x): x is { text: string; target: 'recibos' | 'despesas' } => !!x) : []

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => changeMonth(shiftMonth(month, -1))} aria-label="Mês anterior"
            className="p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280]">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-base font-semibold text-[#111827] capitalize w-44 text-center">{monthLabel(month)}</span>
          <button onClick={() => changeMonth(shiftMonth(month, 1))} aria-label="Próximo mês"
            className="p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280]">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <button onClick={download} disabled={downloading || loading || !ledger}
          className="flex items-center gap-1.5 h-10 px-4 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-[#2563EB] disabled:opacity-50">
          <Download className="w-4 h-4" /> {downloading ? 'Gerando...' : 'Baixar pacote do contador'}
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      {notice && <p role="status" className="text-sm text-[#92400E] bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{notice}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : ledger && t ? (
        <>
          <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 space-y-2">
            <Line label="Receitas de pacientes" value={t.patientRevenueCents} />
            <Line label="Despesas de custeio" value={t.custeioCents} />
            {t.feesCents > 0 && <Line sub label="Tarifas de cobrança (Asaas)" value={t.feesCents} />}
            <Line label="Salários e encargos" value={t.pessoalCents} />
            <Line label="Emolumentos" value={t.emolumentosCents} />
            <Line label="Total dedutível" value={t.deductibleCents} />
            <div className="border-t border-[#E5E7EB] pt-2 flex justify-between text-sm">
              <span className="font-semibold text-[#111827]">Resultado do mês</span>
              <span className={`text-lg font-bold ${t.resultCents >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                {formatCurrency(fromCents(t.resultCents))}
              </span>
            </div>
            <div className="border-t border-[#E5E7EB] pt-2 space-y-2">
              <Line label="Recebimentos de convênios (informativo)" value={t.insuranceRevenueCents} />
              <Line label="Despesas não dedutíveis (informativo)" value={t.nonDeductibleCents} />
            </div>
          </div>

          <p className="text-xs text-[#6B7280]">{DISCLAIMER}</p>

          {alertLines.length > 0 && (
            <ul className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-1 text-sm text-[#92400E]">
              {alertLines.map((a) => (
                <li key={a.text}>
                  <button onClick={() => (a.target === 'recibos' ? showPendingReceipts() : onOpenDespesas())} className="text-left underline hover:no-underline">{a.text}</button>
                </li>
              ))}
            </ul>
          )}

          <div ref={receiptsRef} className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden scroll-mt-4">
            <div className="px-4 py-3 border-b border-[#E5E7EB] flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-[#111827]">Recibos do Receita Saúde</h3>
              <label className="flex items-center gap-2 text-sm text-[#6B7280] cursor-pointer">
                <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)}
                  className="w-4 h-4 rounded border-[#D1D5DB]" />
                Só pendentes
              </label>
            </div>
            {receipts.length === 0 ? (
              <div className="py-10 text-center text-sm text-[#9CA3AF]">Nenhum recibo neste mês.</div>
            ) : (
              <div className="divide-y divide-[#F3F4F6]">
                {receipts.map((r) => {
                  const busy = busyIds.has(r.paymentId)
                  return (
                    <div key={r.paymentId} className="px-4 py-3 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[#111827] truncate">{r.payerName}</p>
                          <p className="text-xs text-[#9CA3AF]">
                            {ddmmyyyy(r.date)}
                          </p>
                          <p className="text-xs text-[#9CA3AF]">
                            Paciente: {r.patientName} · {r.patientCpf ? formatCpf(r.patientCpf) : 'Sem CPF'}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold text-[#111827]">{formatCurrency(fromCents(r.amountCents))}</p>
                          <span className={`text-xs font-medium ${r.issuedAt ? 'text-[#10B981]' : 'text-[#F59E0B]'}`}>
                            {r.issuedAt ? 'Emitido' : 'Pendente'}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-[#3B82F6]">
                        {r.payerCpf ? (
                          <>
                            <span className="text-[#6B7280] font-normal">{formatCpf(r.payerCpf)}</span>
                            <button onClick={() => copy(`cpf-${r.paymentId}`, r.payerCpf!)}
                              className="flex items-center gap-1 hover:underline">
                              <Copy className="w-3 h-3" /> {copied === `cpf-${r.paymentId}` ? 'Copiado' : 'Copiar CPF'}
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="text-[#EF4444]">Sem CPF</span>
                            <Link href={`/pacientes/${r.patientId}`} className="hover:underline">Abrir paciente</Link>
                          </>
                        )}
                        <button onClick={() => copy(`val-${r.paymentId}`, moneyText(r.amountCents))}
                          className="flex items-center gap-1 hover:underline">
                          <Copy className="w-3 h-3" /> {copied === `val-${r.paymentId}` ? 'Copiado' : 'Copiar valor'}
                        </button>
                        <button disabled={busy} onClick={() => toggleIssued(r)} className="hover:underline disabled:opacity-50">
                          {r.issuedAt ? 'Desfazer' : 'Marcar como emitido'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}
