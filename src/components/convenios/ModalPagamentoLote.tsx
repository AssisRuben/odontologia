'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { todayYmd } from '@/lib/messaging/time'
import { glosaDe, paraCentavos, totaisLote } from '@/lib/convenios/pagamentos/calculo'
import { parseValor, valorParaTexto } from '@/lib/convenios/valor'

export type ItemPagamentoLote = { id: string; patient_name: string; code: string; name: string; value: number }

type Linha = { paid: string; glosaCode: string; glosaLabel: string; glosaNote: string }
type Motivo = { code: string; name: string }

const INPUT = 'h-9 px-2.5 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] bg-white'
const mmaaaa = (ymd: string) => `${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`

function BuscaMotivo({
  code,
  label,
  onPick,
}: {
  code: string
  label: string
  onPick: (m: Motivo | null) => void
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Motivo[]>([])
  const [searching, setSearching] = useState(false)
  const [erro, setErro] = useState('')
  const seq = useRef(0)

  useEffect(() => {
    const termo = q.trim()
    const mine = ++seq.current
    if (termo.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([])
      setSearching(false)
      setErro('')
      return
    }
    const timer = setTimeout(async () => {
      setSearching(true)
      setErro('')
      try {
        const res = await fetch(`/api/convenios/motivos?q=${encodeURIComponent(termo)}`, { cache: 'no-store' })
        const json = await res.json().catch(() => ({}))
        if (mine !== seq.current) return // resposta antiga
        if (!res.ok) {
          setResults([])
          setErro(json.error || 'Não foi possível buscar os motivos')
        } else {
          setResults(json.motivos ?? [])
        }
      } catch {
        if (mine !== seq.current) return
        setResults([])
        setErro('Não foi possível buscar os motivos')
      }
      if (mine === seq.current) setSearching(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [q])

  if (code) {
    return (
      <div className="flex items-center gap-2 text-xs text-[#111827]">
        <span className="min-w-0 flex-1 truncate" title={label}>
          <span className="font-mono text-[#6B7280]">{code}</span> {label}
        </span>
        <button type="button" onClick={() => onPick(null)} className="text-[#3B82F6] hover:underline shrink-0">
          Trocar
        </button>
      </div>
    )
  }
  return (
    <div className="space-y-1">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Motivo da glosa (código ou texto)"
        aria-label="Motivo da glosa"
        className={`${INPUT} w-full`}
      />
      {q.trim().length >= 2 && (
        <div className="bg-white rounded-lg border border-[#E5E7EB] divide-y divide-[#F3F4F6] max-h-40 overflow-y-auto">
          {searching ? (
            <p className="px-3 py-2 text-xs text-[#6B7280]">Buscando...</p>
          ) : erro ? (
            <p className="px-3 py-2 text-xs text-[#DC2626]">{erro}</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-[#6B7280]">Nenhum motivo encontrado.</p>
          ) : (
            results.map((m) => (
              <button
                key={m.code}
                type="button"
                onClick={() => {
                  onPick(m)
                  setQ('')
                }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#F3F4F6]"
              >
                <span className="font-mono text-[#6B7280] mr-2">{m.code}</span>
                {m.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export function ModalPagamentoLote({
  lote,
  itens,
  onClose,
  onSaved,
}: {
  lote: { id: string; plano: string; periodEnd: string }
  itens: ItemPagamentoLote[]
  onClose: () => void
  onSaved: () => void
}) {
  const [paidAt, setPaidAt] = useState(todayYmd(new Date(), 'America/Sao_Paulo'))
  const [deposit, setDeposit] = useState('')
  const [linhas, setLinhas] = useState<Record<string, Linha>>(() =>
    Object.fromEntries(itens.map((i) => [i.id, { paid: '', glosaCode: '', glosaLabel: '', glosaNote: '' }])),
  )
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')

  const mudar = (id: string, patch: Partial<Linha>) => setLinhas((l) => ({ ...l, [id]: { ...l[id], ...patch } }))
  const pago = (i: ItemPagamentoLote): number => (linhas[i.id].paid.trim() === '' ? NaN : parseValor(linhas[i.id].paid))

  const tudoPago = () => {
    setLinhas((l) =>
      Object.fromEntries(
        itens.map((i) => [i.id, { ...l[i.id], paid: valorParaTexto(i.value), glosaCode: '', glosaLabel: '', glosaNote: '' }]),
      ),
    )
  }

  const totais = totaisLote(
    itens.map((i) => ({ value: i.value, paid_value: Number.isFinite(pago(i)) ? pago(i) : null })),
    null,
  )
  const depositado = deposit.trim() === '' ? NaN : parseValor(deposit)
  const diferenca = Number.isFinite(depositado) ? (paraCentavos(depositado) - paraCentavos(totais.pago)) / 100 : 0

  const salvar = async () => {
    if (loading) return
    const lista = []
    for (const i of itens) {
      const p = pago(i)
      if (!Number.isFinite(p) || p < 0 || paraCentavos(p) > paraCentavos(i.value)) {
        setErro(`Valor pago inválido em ${i.patient_name} (${i.code})`)
        return
      }
      const l = linhas[i.id]
      const glosado = paraCentavos(p) < paraCentavos(i.value)
      if (glosado && !l.glosaCode) {
        setErro(`Informe o motivo da glosa em ${i.patient_name} (${i.code})`)
        return
      }
      lista.push({ id: i.id, paidValue: p, glosaCode: glosado ? l.glosaCode : null, glosaNote: glosado ? l.glosaNote : null })
    }
    if (!Number.isFinite(depositado) || depositado < 0) {
      setErro('Informe o valor depositado')
      return
    }
    setLoading(true)
    setErro('')
    try {
      const res = await fetch(`/api/convenios/lotes/${lote.id}/pagamento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paidAt, deposit: depositado, itens: lista }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErro(json.error || 'Não foi possível registrar o pagamento')
        setLoading(false)
        return
      }
      window.dispatchEvent(new Event('convenios:changed'))
      onSaved()
    } catch {
      setErro('Não foi possível registrar o pagamento')
      setLoading(false)
    }
  }

  return (
    <div className="no-print fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          <h2 className="font-semibold text-[#111827]">
            Registrar pagamento · {lote.plano} · {mmaaaa(lote.periodEnd)}
          </h2>
          <button type="button" onClick={onClose} aria-label="Fechar">
            <X className="w-5 h-5 text-[#6B7280]" />
          </button>
        </div>

        <div className="px-5 py-2 flex flex-wrap items-end gap-3 border-b border-[#F3F4F6]">
          <label className="text-sm text-[#374151]">
            Data do depósito
            <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className={`${INPUT} block mt-1`} />
          </label>
          <label className="text-sm text-[#374151]">
            Valor depositado (R$)
            <input
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
              inputMode="decimal"
              className={`${INPUT} block mt-1 w-36 text-right`}
            />
          </label>
          <button
            type="button"
            onClick={tudoPago}
            className="px-3 h-9 text-sm rounded-lg border border-[#E5E7EB] text-[#374151] hover:bg-[#F9FAFB]"
          >
            Tudo pago
          </button>
        </div>

        <div className="px-5 py-2 overflow-y-auto flex-1 divide-y divide-[#F3F4F6]">
          {itens.map((i) => {
            const l = linhas[i.id]
            const p = pago(i)
            const glosa = Number.isFinite(p) ? glosaDe(i.value, p) : 0
            const glosado = Number.isFinite(p) && paraCentavos(p) < paraCentavos(i.value)
            return (
              <div key={i.id} className="py-2 space-y-1.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <div className="flex-1 min-w-48">
                    <p className="text-[#111827] font-medium">{i.patient_name}</p>
                    <p className="text-xs text-[#6B7280]">
                      {i.code} · {i.name}
                    </p>
                  </div>
                  <span className="text-xs text-[#6B7280]">Enviado {formatCurrency(i.value)}</span>
                  <input
                    value={l.paid}
                    onChange={(e) => mudar(i.id, { paid: e.target.value })}
                    inputMode="decimal"
                    placeholder="Pago (R$)"
                    aria-label={`Valor pago de ${i.patient_name} (${i.code})`}
                    className={`${INPUT} w-28 text-right`}
                  />
                  <span className={`w-28 text-right text-xs ${glosa > 0 ? 'text-[#DC2626]' : 'text-[#6B7280]'}`}>
                    Glosado {formatCurrency(glosa)}
                  </span>
                </div>
                {glosado && (
                  <div className="grid sm:grid-cols-2 gap-2">
                    <BuscaMotivo
                      code={l.glosaCode}
                      label={l.glosaLabel}
                      onPick={(m) => mudar(i.id, { glosaCode: m?.code ?? '', glosaLabel: m?.name ?? '' })}
                    />
                    <input
                      value={l.glosaNote}
                      onChange={(e) => mudar(i.id, { glosaNote: e.target.value })}
                      maxLength={200}
                      placeholder="Observação (opcional)"
                      aria-label="Observação da glosa"
                      className={`${INPUT} w-full`}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="px-5 py-3 border-t border-[#E5E7EB] space-y-2">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-[#111827]">
            <span>Enviado: <strong>{formatCurrency(totais.enviado)}</strong></span>
            <span>Pago: <strong>{formatCurrency(totais.pago)}</strong></span>
            <span>Glosado: <strong>{formatCurrency(totais.glosado)}</strong></span>
            <span>Depositado: <strong>{Number.isFinite(depositado) ? formatCurrency(depositado) : '—'}</strong></span>
          </div>
          {diferenca !== 0 && (
            <p className="text-sm text-[#92400E] bg-[#FEF3C7] rounded-lg px-3 py-2">
              Diferença de {formatCurrency(Math.abs(diferenca))} entre o depositado e a soma paga
            </p>
          )}
          {erro && <p className="text-sm text-[#DC2626]">{erro}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded-lg border border-[#E5E7EB]">
              Cancelar
            </button>
            <button
              type="button"
              onClick={salvar}
              disabled={loading}
              className="px-3 py-2 text-sm rounded-lg bg-[#3B82F6] text-white disabled:opacity-50"
            >
              {loading ? 'Salvando...' : 'Registrar pagamento'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
