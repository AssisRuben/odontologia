'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { LOST_REASONS } from '@/lib/orcamentos/etapas'
import type { OpenBudget } from '@/lib/orcamentos/publico'

function brl(value: number): string {
  return 'R$ ' + value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function brDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

function maskCpf(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11)
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2')
}

type Stage = 'form' | 'decline' | 'approved' | 'declined'

export default function AprovacaoPaciente({ token, budget }: { token: string; budget: OpenBudget }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(budget.items.map((i) => i.id)))
  const [name, setName] = useState('')
  const [cpf, setCpf] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [stage, setStage] = useState<Stage>('form')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const viewed = useRef(false)

  useEffect(() => {
    if (viewed.current) return
    viewed.current = true
    fetch(`/api/public/orcamento/${token}/visto`, { method: 'POST' }).catch(() => undefined)
  }, [token])

  const total = useMemo(
    () => budget.items.filter((i) => selected.has(i.id)).reduce((s, i) => s + Math.round(i.unitPrice * 100) * i.quantity, 0) / 100,
    [budget.items, selected],
  )

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function send(path: string, payload: unknown, onOk: () => void) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/public/orcamento/${token}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) return onOk()
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      setError(data?.error ?? 'Não foi possível concluir. Tente novamente.')
    } catch {
      setError('Sem conexão. Tente novamente.')
    } finally {
      setBusy(false)
    }
  }

  const canSign = selected.size > 0 && name.trim().length >= 3 && cpf.replace(/\D/g, '').length === 11 && agreed && !busy

  const shell = (children: React.ReactNode) => (
    <main className="min-h-full bg-[#F9FAFB] px-4 py-6">
      <div className="mx-auto w-full max-w-lg space-y-4">{children}</div>
    </main>
  )

  if (stage === 'approved') {
    return shell(
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 text-center">
        <p className="text-2xl font-semibold text-[#111827]">Aprovado ✓</p>
        <p className="mt-2 text-sm text-[#6B7280]">Obrigado! A clínica entrará em contato para agendar.</p>
        <a
          href={`/api/public/orcamento/${token}/comprovante`}
          className="mt-5 inline-block rounded-xl bg-[#3B82F6] px-5 py-3 text-sm font-medium text-white"
        >
          Baixar comprovante
        </a>
      </div>,
    )
  }

  if (stage === 'declined') {
    return shell(
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 text-center">
        <p className="text-lg font-semibold text-[#111827]">Resposta enviada</p>
        <p className="mt-2 text-sm text-[#6B7280]">Obrigado por avisar. Se mudar de ideia, fale com a clínica.</p>
      </div>,
    )
  }

  return shell(
    <>
      <header className="rounded-xl border border-[#E5E7EB] bg-white p-4">
        {budget.clinic.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={budget.clinic.logoUrl} alt="" className="mb-2 h-10 w-auto" />
        )}
        <h1 className="text-lg font-semibold text-[#111827]">{budget.clinic.name}</h1>
        <p className="text-sm text-[#6B7280]">
          Orçamento #{budget.number} · {brDate(budget.createdAt)}
          {budget.professional ? ` · ${budget.professional}` : ''}
        </p>
        {budget.validUntil && <p className="text-sm text-[#6B7280]">Válido até {brDate(budget.validUntil)}</p>}
      </header>

      <section className="rounded-xl border border-[#E5E7EB] bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-[#111827]">Itens do tratamento</h2>
        <p className="mb-3 text-xs text-[#6B7280]">Desmarque o que você não quer fazer agora.</p>
        <ul className="divide-y divide-[#E5E7EB]">
          {budget.items.map((i) => (
            <li key={i.id}>
              <label className="flex cursor-pointer items-start gap-3 py-3">
                <input
                  type="checkbox"
                  checked={selected.has(i.id)}
                  onChange={() => toggle(i.id)}
                  disabled={busy}
                  className="mt-1 h-5 w-5 accent-[#3B82F6]"
                />
                <span className="flex-1 text-sm text-[#111827]">
                  {i.procedure}
                  <span className="block text-xs text-[#6B7280]">
                    {i.tooth ? `Dente ${i.tooth} · ` : ''}
                    {i.quantity} × {brl(i.unitPrice)}
                  </span>
                </span>
                <span className="text-sm font-medium text-[#111827]">{brl((Math.round(i.unitPrice * 100) * i.quantity) / 100)}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center justify-between border-t border-[#E5E7EB] pt-3">
          <span className="text-sm text-[#6B7280]">Total selecionado</span>
          <span className="text-lg font-semibold text-[#111827]" aria-live="polite">{brl(total)}</span>
        </div>
      </section>

      {stage === 'form' ? (
        <section className="space-y-3 rounded-xl border border-[#E5E7EB] bg-white p-4">
          <h2 className="text-sm font-semibold text-[#111827]">Assinatura</h2>
          <label className="block text-sm text-[#111827]">
            Nome completo
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              className="mt-1 w-full rounded-xl border border-[#E5E7EB] px-3 py-3 text-base"
            />
          </label>
          <label className="block text-sm text-[#111827]">
            CPF
            <input
              value={cpf}
              onChange={(e) => setCpf(maskCpf(e.target.value))}
              inputMode="numeric"
              placeholder="000.000.000-00"
              className="mt-1 w-full rounded-xl border border-[#E5E7EB] px-3 py-3 text-base"
            />
          </label>
          <label className="flex items-start gap-3 text-sm text-[#111827]">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 h-5 w-5 accent-[#3B82F6]" />
            Li e concordo com os itens selecionados e com o valor total.
          </label>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <button
            type="button"
            disabled={!canSign}
            onClick={() =>
              send('assinar', { itemIds: [...selected], name: name.trim(), cpf, agreed }, () => setStage('approved'))
            }
            className="w-full rounded-xl bg-[#3B82F6] px-4 py-3 text-base font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Enviando...' : 'Assinar e aprovar'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => { setError(null); setStage('decline') }}
            className="w-full rounded-xl border border-[#E5E7EB] px-4 py-3 text-sm font-medium text-[#6B7280]"
          >
            Não quero seguir
          </button>
        </section>
      ) : (
        <section className="space-y-3 rounded-xl border border-[#E5E7EB] bg-white p-4">
          <h2 className="text-sm font-semibold text-[#111827]">Não quero seguir</h2>
          <label className="block text-sm text-[#111827]">
            Motivo (opcional)
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-3 text-base"
            >
              <option value="">Prefiro não dizer</option>
              {LOST_REASONS.filter((r) => r.code !== 'sem_resposta').map((r) => (
                <option key={r.code} value={r.code}>{r.label}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-[#111827]">
            Observação (opcional)
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={3}
              className="mt-1 w-full rounded-xl border border-[#E5E7EB] px-3 py-3 text-base"
            />
          </label>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <button
            type="button"
            disabled={busy}
            onClick={() => send('recusar', { reason: reason || undefined, note: note || undefined }, () => setStage('declined'))}
            className="w-full rounded-xl bg-[#111827] px-4 py-3 text-base font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Enviando...' : 'Confirmar'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => { setError(null); setStage('form') }}
            className="w-full rounded-xl border border-[#E5E7EB] px-4 py-3 text-sm font-medium text-[#6B7280]"
          >
            Voltar
          </button>
        </section>
      )}
    </>,
  )
}
