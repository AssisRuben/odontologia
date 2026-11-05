'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, FileText, MoreVertical, X } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { PAYMENT_METHOD_LABELS } from '@/types'
import type { Payment, FiscalInvoice, PaymentMethod, PaymentStatus } from '@/types'
import { fromDbPaidAt } from '@/lib/payments/dates'
import { parseReaisInput, fromCents } from '@/lib/payments/money'
import { ModalEmitirNota } from './ModalEmitirNota'
import { errorText } from './errorText'

interface Props {
  payments: Payment[]
  invoices: FiscalInvoice[]
  showPatient?: boolean
  onChanged: () => void | Promise<void>
}

interface NfseInfo { enabled: boolean | null; description: string; invalidKey: boolean }

type Dialog =
  | { kind: 'due'; p: Payment }
  | { kind: 'receive'; p: Payment }
  | { kind: 'cancel'; p: Payment }
  | { kind: 'cancelNote'; p: Payment; inv: FiscalInvoice }
  | { kind: 'note'; p: Payment }

type ActionId = 'copy' | 'whatsapp' | 'due' | 'receive' | 'cancel' | 'note' | 'retry' | 'pdf' | 'sendNote' | 'cancelNote'
interface MenuItem { id: ActionId; label: string; danger?: boolean; disabled?: boolean; title?: string }

const RECONNECT_TITLE = 'Reconecte o Asaas em Configurações → Pagamentos'
/** Ações que passam pelo Asaas num lançamento do Asaas. */
const PROVIDER_ACTIONS: ActionId[] = ['copy', 'whatsapp', 'due', 'receive', 'cancel']
/** Ações de nota: passam pelo Asaas em qualquer lançamento. */
const INVOICE_ACTIONS: ActionId[] = ['note', 'retry', 'cancelNote']

/** Ações disponíveis para um pagamento; as indisponíveis ficam de fora. Com a chave inválida, as do Asaas ficam desabilitadas. */
function menuItems(p: Payment, inv: FiscalInvoice | undefined, noteBlocked = false, invalidKey = false): MenuItem[] {
  const items = baseMenuItems(p, inv, noteBlocked)
  if (!invalidKey) return items
  const asaasRow = p.charge_kind !== 'manual'
  return items.map(it =>
    INVOICE_ACTIONS.includes(it.id) || (asaasRow && PROVIDER_ACTIONS.includes(it.id))
      ? { ...it, disabled: true, title: RECONNECT_TITLE }
      : it)
}

function baseMenuItems(p: Payment, inv: FiscalInvoice | undefined, noteBlocked: boolean): MenuItem[] {
  const items: MenuItem[] = []
  if (p.provider_state === 'creating') return items
  const open = p.status === 'pending' || p.status === 'overdue'
  if (open && p.invoice_url) {
    items.push({ id: 'copy', label: 'Copiar link' })
    items.push({ id: 'whatsapp', label: 'Enviar link pelo WhatsApp' })
  }
  if (open) items.push({ id: 'due', label: 'Alterar vencimento' })
  if (open && p.charge_kind !== 'cartao_parcelado') items.push({ id: 'receive', label: 'Marcar como pago' })
  if (open) items.push({ id: 'cancel', label: 'Cancelar', danger: true })
  const noteAllowed = p.charge_kind !== 'cartao_parcelado' || (p.installment_number ?? 1) === 1
  if (p.status === 'paid' && !inv && noteAllowed) {
    items.push(noteBlocked
      ? { id: 'note', label: 'Emitir nota', disabled: true, title: 'Configure a nota fiscal no painel do Asaas' }
      : { id: 'note', label: 'Emitir nota' })
  }
  if (inv?.status === 'error') items.push({ id: 'retry', label: 'Tentar novamente' })
  if (inv?.pdf_url) items.push({ id: 'pdf', label: 'Ver PDF' })
  if (inv?.status === 'authorized' && inv.pdf_url) items.push({ id: 'sendNote', label: 'Enviar nota pelo WhatsApp' })
  if (inv?.status === 'authorized') items.push({ id: 'cancelNote', label: 'Cancelar nota', danger: true })
  return items
}

const DEFAULT_NFSE_DESC = 'Serviços odontológicos: {descricao}'

const STATUS: Record<PaymentStatus, { label: string; cls: string }> = {
  pending:   { label: 'A vencer',  cls: 'bg-blue-50 text-blue-700' },
  overdue:   { label: 'Atrasado',  cls: 'bg-red-50 text-red-700' },
  paid:      { label: 'Pago',      cls: 'bg-green-50 text-green-700' },
  cancelled: { label: 'Cancelado', cls: 'bg-gray-100 text-gray-600' },
  refunded:  { label: 'Estornado', cls: 'bg-amber-50 text-amber-700' },
}

const ALERTS = {
  chargeback: 'Contestação no cartão. Veja o painel do Asaas.',
  refunded_with_invoice: 'Este pagamento foi estornado. Cancele a nota, se necessário.',
} as const

const inputCls = 'w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#3B82F6]'

function todayLocal(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function brDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

function activeInvoiceOf(paymentId: string, invoices: FiscalInvoice[]): FiscalInvoice | undefined {
  return invoices
    .filter(i => i.payment_id === paymentId && i.status !== 'cancelled')
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0]
}

function reaisInput(amount: number): string {
  return fromCents(Math.round(amount * 100)).toFixed(2).replace('.', ',')
}

export default function ListaPagamentos({ payments, invoices, showPatient, onChanged }: Props) {
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [menu, setMenu] = useState<{ id: string; top: number; right: number } | null>(null)
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null)
  const [nfse, setNfse] = useState<NfseInfo>({ enabled: null, description: DEFAULT_NFSE_DESC, invalidKey: false })
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const inFlight = useRef(false)

  useEffect(() => {
    let active = true
    fetch('/api/payments/connection', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!active || !d) return
        setNfse({
          enabled: !!(d.connected && d.fiscal?.configured),
          description: typeof d.nfse_description === 'string' && d.nfse_description ? d.nfse_description : DEFAULT_NFSE_DESC,
          invalidKey: !!d.connected && d.status === 'invalid_key',
        })
      })
      .catch(() => { /* usa os padrões */ })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close) }
  }, [menu])

  const invoiceByPayment = useMemo(() => {
    const m = new Map<string, FiscalInvoice | undefined>()
    for (const p of payments) m.set(p.id, activeInvoiceOf(p.id, invoices))
    return m
  }, [payments, invoices])

  /** Chama a rota; devolve o texto do erro ou null. Protegido contra envio duplo. */
  async function call(url: string, body?: unknown): Promise<string | null> {
    if (inFlight.current) return 'Aguarde a ação em andamento.'
    inFlight.current = true
    setBusy(true)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) return errorText(res.status, data)
    } catch {
      return 'Falha de conexão. Tente novamente.'
    } finally {
      inFlight.current = false
      setBusy(false)
    }
    // a ação já deu certo: falha ao recarregar não vira erro da ação
    try { await onChanged() } catch (e) { console.error('[ListaPagamentos] falha ao recarregar:', e) }
    return null
  }

  /** Ação direta (sem janela): mostra o resultado em um aviso. */
  async function quick(url: string, okText: string, body?: unknown) {
    setMenu(null)
    const err = await call(url, body)
    setToast({ text: err ?? okText, error: !!err })
  }

  /** Ação dentro de janela: fecha em caso de sucesso, mostra o erro na janela. */
  async function inDialog(url: string, okText: string, body?: unknown) {
    setDialogError('')
    const err = await call(url, body)
    if (err) { setDialogError(err); return }
    setDialog(null)
    setToast({ text: okText, error: false })
  }

  function openDialog(d: Dialog) {
    setMenu(null)
    setDialogError('')
    setDialog(d)
  }

  async function copyLink(p: Payment) {
    setMenu(null)
    try {
      await navigator.clipboard.writeText(p.invoice_url!)
      setToast({ text: 'Link copiado', error: false })
    } catch {
      setToast({ text: 'Não foi possível copiar o link.', error: true })
    }
  }

  function groupSum(p: Payment): number {
    if (p.charge_kind !== 'cartao_parcelado' || !p.charge_group_id) return p.amount
    const sum = payments
      .filter(x => x.charge_group_id === p.charge_group_id && x.status !== 'cancelled' && x.status !== 'refunded')
      .reduce((s, x) => s + x.amount, 0)
    return sum > 0 ? Math.round(sum * 100) / 100 : p.amount
  }

  function noteDescription(p: Payment): string {
    return nfse.description.replace(/\{descricao\}/g, p.description || 'Pagamento')
  }

  function perform(id: ActionId, p: Payment, inv: FiscalInvoice | undefined) {
    switch (id) {
      case 'copy': return copyLink(p)
      case 'whatsapp': return quick(`/api/payments/${p.id}/send-link`, 'Link enviado pelo WhatsApp')
      case 'due': return openDialog({ kind: 'due', p })
      case 'receive': return openDialog({ kind: 'receive', p })
      case 'cancel': return openDialog({ kind: 'cancel', p })
      case 'note': return openDialog({ kind: 'note', p })
      case 'retry': return quick(`/api/payments/${p.id}/invoice`, 'Nota enviada para emissão', {})
      case 'pdf': setMenu(null); window.open(inv?.pdf_url, '_blank', 'noopener'); return
      case 'sendNote': return quick(`/api/invoices/${inv!.id}/send`, 'Nota enviada pelo WhatsApp')
      case 'cancelNote': return openDialog({ kind: 'cancelNote', p, inv: inv! })
    }
  }

  if (payments.length === 0) {
    return <div className="flex items-center justify-center h-40 text-sm text-[#9CA3AF]">Nenhum pagamento registrado.</div>
  }

  const menuPayment = menu ? payments.find(p => p.id === menu.id) : undefined

  return (
    <>
      <div className="divide-y divide-[#F3F4F6]">
        {payments.map(p => {
          const st = STATUS[p.status] ?? { label: p.status, cls: 'bg-gray-100 text-gray-600' }
          const inv = invoiceByPayment.get(p.id)
          const creating = p.provider_state === 'creating'
          const paidAt = fromDbPaidAt(p.paid_at ?? null)
          const hasItems = menuItems(p, inv).length > 0
          const patientName = (p.patient as { name?: string } | undefined)?.name
          return (
            <div key={p.id} className="px-4 sm:px-5 py-3 hover:bg-[#F9FAFB] transition-colors">
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#111827] truncate">
                    {showPatient && patientName && <span className="text-[#6B7280] font-normal">{patientName} · </span>}
                    {p.description || 'Pagamento'}
                    {(p.installment_count ?? 0) > 1 && (
                      <span className="text-[#6B7280] font-normal"> · Parcela {p.installment_number}/{p.installment_count}</span>
                    )}
                  </p>
                  <p className="text-xs text-[#6B7280]">
                    {p.status === 'paid' && paidAt ? `Pago em ${brDate(paidAt)}` : p.due_date ? `Venc. ${brDate(p.due_date)}` : ''}
                    {p.payment_method && ` · ${PAYMENT_METHOD_LABELS[p.payment_method as PaymentMethod] ?? p.payment_method}`}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-[#111827]">{formatCurrency(p.amount)}</p>
                  <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${creating ? 'bg-gray-100 text-gray-600' : st.cls}`}>
                    {creating ? 'Criando…' : st.label}
                  </span>
                </div>
                {hasItems ? (
                  <button
                    aria-label="Ações do pagamento"
                    aria-haspopup="menu"
                    onClick={e => {
                      const r = e.currentTarget.getBoundingClientRect()
                      setMenu(menu?.id === p.id ? null : { id: p.id, top: r.bottom + 4, right: window.innerWidth - r.right })
                    }}
                    className="p-1.5 rounded-lg text-[#6B7280] hover:bg-[#F3F4F6] shrink-0"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>
                ) : <span className="w-7 shrink-0" />}
              </div>
              {(inv || p.alert) && (
                <div className="mt-1.5 space-y-1">
                  {inv && <InvoiceBadge inv={inv} />}
                  {p.alert && ALERTS[p.alert] && (
                    <p role="alert" className="flex items-start gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" /> {ALERTS[p.alert]}
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {menu && menuPayment && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div role="menu" style={{ top: menu.top, right: menu.right }}
            className="fixed z-50 w-60 bg-white border border-[#E5E7EB] rounded-lg shadow-lg py-1">
            {menuItems(menuPayment, invoiceByPayment.get(menuPayment.id), nfse.enabled === false, nfse.invalidKey).map(it => (
              <button key={it.id} role="menuitem" disabled={busy || it.disabled} title={it.title} onClick={() => perform(it.id, menuPayment, invoiceByPayment.get(menuPayment.id))}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-[#F9FAFB] disabled:opacity-50 ${it.danger ? 'text-red-600' : 'text-[#374151]'}`}>
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}

      {toast && (
        <div role="status" className={`fixed bottom-4 right-4 z-[60] text-white text-sm px-4 py-2 rounded-lg shadow-lg max-w-sm ${toast.error ? 'bg-red-600' : 'bg-[#111827]'}`}>
          {toast.text}
        </div>
      )}

      {dialog?.kind === 'due' && (
        <DueDateDialog p={dialog.p} busy={busy} error={dialogError} onClose={() => setDialog(null)}
          onSubmit={d => inDialog(`/api/payments/${dialog.p.id}/due-date`, 'Vencimento alterado', { dueDate: d })} />
      )}
      {dialog?.kind === 'receive' && (
        <ReceiveDialog p={dialog.p} busy={busy} error={dialogError} onClose={() => setDialog(null)}
          onSubmit={(b, err) => {
            if (err) { setDialogError(err); return }
            void inDialog(`/api/payments/${dialog.p.id}/receive`, 'Pagamento registrado', b)
          }} />
      )}
      {dialog?.kind === 'cancel' && (
        <CancelDialog p={dialog.p} busy={busy} error={dialogError} onClose={() => setDialog(null)}
          onSubmit={scope => inDialog(`/api/payments/${dialog.p.id}/cancel`, scope === 'one' ? 'Cobrança cancelada' : 'Cobranças canceladas', { scope })} />
      )}
      {dialog?.kind === 'cancelNote' && (
        <Shell title="Cancelar nota" onClose={() => setDialog(null)} busy={busy}>
          <p className="text-sm text-[#374151]">Cancelar a nota nº {dialog.inv.number ?? '—'}? Esta ação não pode ser desfeita.</p>
          <Footer error={dialogError} busy={busy} confirmLabel="Cancelar nota" danger closeLabel="Voltar"
            onClose={() => setDialog(null)} onConfirm={() => inDialog(`/api/invoices/${dialog.inv.id}/cancel`, 'Cancelamento da nota solicitado')} />
        </Shell>
      )}
      {dialog?.kind === 'note' && (
        <ModalEmitirNota
          paymentId={dialog.p.id}
          defaultAmount={groupSum(dialog.p)}
          isGroup={dialog.p.charge_kind === 'cartao_parcelado'}
          defaultDescription={noteDescription(dialog.p)}
          onClose={() => setDialog(null)}
          onDone={() => { setToast({ text: 'Nota enviada para emissão', error: false }); Promise.resolve(onChanged()).catch(e => console.error('[ListaPagamentos] falha ao recarregar:', e)) }}
        />
      )}
    </>
  )
}

function InvoiceBadge({ inv }: { inv: FiscalInvoice }) {
  const [open, setOpen] = useState(false)
  const map: Record<string, { label: string; cls: string }> = {
    scheduled:  { label: 'Nota agendada', cls: 'text-blue-700 bg-blue-50' },
    authorized: { label: `Nota emitida${inv.number ? ` nº ${inv.number}` : ''}`, cls: 'text-green-700 bg-green-50' },
    error:      { label: 'Erro na nota', cls: 'text-red-700 bg-red-50' },
    cancelling: { label: 'Cancelando nota', cls: 'text-amber-700 bg-amber-50' },
  }
  const m = map[inv.status]
  if (!m) return null
  const isError = inv.status === 'error'
  return (
    <div>
      <button type="button" disabled={!isError} onClick={() => setOpen(o => !o)} title={isError ? inv.error : undefined}
        className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${m.cls} ${isError ? 'cursor-pointer' : 'cursor-default'}`}>
        <FileText className="w-3 h-3" /> {m.label}
      </button>
      {isError && open && <p className="text-xs text-red-600 mt-1">{inv.error || 'Erro desconhecido.'}</p>}
    </div>
  )
}

function Shell({ title, onClose, busy, children }: { title: string; onClose: () => void; busy: boolean; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={busy ? undefined : onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm mx-4">
        <div className="flex items-center justify-between p-5 border-b border-[#E5E7EB]">
          <h2 className="text-base font-semibold text-[#111827]">{title}</h2>
          <button onClick={onClose} disabled={busy} className="p-1 rounded text-[#9CA3AF] hover:text-[#374151]" aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  )
}

function Footer({ error, busy, confirmLabel, closeLabel = 'Cancelar', danger, onClose, onConfirm }: {
  error: string; busy: boolean; confirmLabel: string; closeLabel?: string; danger?: boolean; onClose: () => void; onConfirm: () => void
}) {
  return (
    <>
      {error && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button onClick={onClose} disabled={busy} className="h-10 px-4 rounded-lg border border-[#E5E7EB] text-sm text-[#374151] hover:bg-[#F9FAFB]">{closeLabel}</button>
        <button onClick={onConfirm} disabled={busy}
          className={`h-10 px-4 rounded-lg text-white text-sm font-medium disabled:opacity-60 ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-[#3B82F6] hover:bg-[#2563EB]'}`}>
          {busy ? 'Aguarde…' : confirmLabel}
        </button>
      </div>
    </>
  )
}

function DueDateDialog({ p, busy, error, onClose, onSubmit }: {
  p: Payment; busy: boolean; error: string; onClose: () => void; onSubmit: (d: string) => void
}) {
  const [date, setDate] = useState(p.due_date?.slice(0, 10) ?? todayLocal())
  return (
    <Shell title="Alterar vencimento" onClose={onClose} busy={busy}>
      <div>
        <label htmlFor="lp-due" className="block text-sm font-medium text-[#111827] mb-1">Novo vencimento</label>
        <input id="lp-due" type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
      </div>
      <Footer error={error} busy={busy} confirmLabel="Salvar" onClose={onClose} onConfirm={() => { if (date) onSubmit(date) }} />
    </Shell>
  )
}

function ReceiveDialog({ p, busy, error, onClose, onSubmit }: {
  p: Payment; busy: boolean; error: string; onClose: () => void
  onSubmit: (body: { paidAt: string; amountCents: number; method?: PaymentMethod }, err?: string) => void
}) {
  const [paidAt, setPaidAt] = useState(todayLocal)
  const [amount, setAmount] = useState(() => reaisInput(p.amount))
  const [method, setMethod] = useState<PaymentMethod | ''>(p.payment_method ?? '')
  return (
    <Shell title="Marcar como pago" onClose={onClose} busy={busy}>
      <div>
        <label htmlFor="lp-pdata" className="block text-sm font-medium text-[#111827] mb-1">Data do pagamento</label>
        <input id="lp-pdata" type="date" className={inputCls} value={paidAt} onChange={e => setPaidAt(e.target.value)} />
      </div>
      <div>
        <label htmlFor="lp-pval" className="block text-sm font-medium text-[#111827] mb-1">Valor recebido (R$)</label>
        <input id="lp-pval" inputMode="decimal" className={inputCls} value={amount} onChange={e => setAmount(e.target.value)} />
      </div>
      <div>
        <label htmlFor="lp-pmet" className="block text-sm font-medium text-[#111827] mb-1">Forma de pagamento</label>
        <select id="lp-pmet" className={inputCls} value={method} onChange={e => setMethod(e.target.value as PaymentMethod | '')}>
          <option value="">—</option>
          {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map(m => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
        </select>
      </div>
      <Footer error={error} busy={busy} confirmLabel="Confirmar pagamento" onClose={onClose}
        onConfirm={() => {
          const cents = parseReaisInput(amount)
          if (!paidAt) return onSubmit({ paidAt, amountCents: 0 }, 'Informe a data do pagamento.')
          if (cents === null || cents <= 0) return onSubmit({ paidAt, amountCents: 0 }, 'Informe um valor válido.')
          onSubmit({ paidAt, amountCents: cents, ...(method ? { method } : {}) })
        }} />
    </Shell>
  )
}

function CancelDialog({ p, busy, error, onClose, onSubmit }: {
  p: Payment; busy: boolean; error: string; onClose: () => void; onSubmit: (scope: 'one' | 'remaining') => void
}) {
  const [scope, setScope] = useState<'one' | 'remaining'>('one')
  const multi = (p.installment_count ?? 0) > 1
  return (
    <Shell title="Cancelar cobrança" onClose={onClose} busy={busy}>
      <p className="text-sm text-[#374151]">
        Cancelar {multi ? `a parcela ${p.installment_number}/${p.installment_count}` : 'esta cobrança'} ({formatCurrency(p.amount)})? Esta ação não pode ser desfeita.
      </p>
      {multi && (
        <div className="space-y-2 text-sm text-[#374151]">
          <label className="flex items-center gap-2"><input type="radio" checked={scope === 'one'} onChange={() => setScope('one')} /> Só esta parcela</label>
          <label className="flex items-center gap-2"><input type="radio" checked={scope === 'remaining'} onChange={() => setScope('remaining')} /> Esta e as próximas não pagas</label>
        </div>
      )}
      <Footer error={error} busy={busy} confirmLabel="Cancelar cobrança" closeLabel="Voltar" danger onClose={onClose} onConfirm={() => onSubmit(multi ? scope : 'one')} />
    </Shell>
  )
}
