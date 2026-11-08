'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Printer, X } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { todayYmd } from '@/lib/messaging/time'
import { diasEntre } from '@/lib/convenios/periodo'
import type { BatchStatus, GuideTooth } from '@/types'

type ItemLote = {
  id: string
  patient_id: string
  patient_name: string
  insurance_card: string | null
  guide_number: string | null
  password: string | null
  code: string
  name: string
  teeth: GuideTooth[]
  executed_at: string | null
  value: number
  typed: boolean
  atrasado: boolean
}

type Lote = {
  id: string
  plan: { id: string; name: string }
  period_start: string
  period_end: string
  due_date: string
  status: BatchStatus
  protocol: string | null
  sent_at: string | null
  total: number
  itens: ItemLote[]
}

const dmy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`
const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`
const mmaaaa = (ymd: string) => `${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`
const hoje = () => todayYmd(new Date(), 'America/Sao_Paulo')

function textoPrazo(due: string, today: string): string {
  const n = diasEntre(today, due)
  const quando =
    n > 0 ? `faltam ${n} ${n === 1 ? 'dia' : 'dias'}` : n === 0 ? 'vence hoje' : `vencido há ${-n} ${n === -1 ? 'dia' : 'dias'}`
  return `Prazo: ${dm(due)} (${quando})`
}

const dentes = (t: GuideTooth[]) =>
  t.map((d) => (d.faces.length ? `${d.tooth} ${d.faces.join('')}` : `${d.tooth}`)).join(', ')

function agrupar(itens: ItemLote[]) {
  const grupos = new Map<
    string,
    { paciente: string; carteirinha: string | null; guia: string | null; senha: string | null; itens: ItemLote[] }
  >()
  for (const i of itens) {
    const k = `${i.patient_id}|${i.guide_number ?? ''}|${i.password ?? ''}`
    const g = grupos.get(k) ?? {
      paciente: i.patient_name,
      carteirinha: i.insurance_card,
      guia: i.guide_number,
      senha: i.password,
      itens: [],
    }
    g.itens.push(i)
    grupos.set(k, g)
  }
  return [...grupos.entries()]
}

export function AbaLotes({ loteInicial }: { loteInicial: string | null }) {
  const [lotes, setLotes] = useState<Lote[] | null>(null)
  const [erro, setErro] = useState('')
  const [aberto, setAberto] = useState<string | null>(loteInicial)
  const [enviando, setEnviando] = useState<Lote | null>(null)
  const rolou = useRef(false)

  const carregar = useCallback(async () => {
    try {
      const res = await fetch('/api/convenios/lotes', { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErro(json.error || 'Não foi possível carregar os lotes')
        return
      }
      setErro('')
      setLotes(json.lotes ?? [])
    } catch {
      setErro('Não foi possível carregar os lotes')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregar()
  }, [carregar])

  useEffect(() => {
    if (!lotes || !loteInicial || rolou.current) return
    const el = document.getElementById(`lote-${loteInicial}`)
    if (el) {
      rolou.current = true
      el.scrollIntoView({ block: 'start' })
    }
  }, [lotes, loteInicial])

  const mudou = () => window.dispatchEvent(new Event('convenios:changed'))

  const alternarDigitado = async (lote: Lote, item: ItemLote) => {
    const novo = !item.typed
    const aplicar = (typed: boolean) =>
      setLotes(
        (ls) =>
          ls &&
          ls.map((l) =>
            l.id === lote.id ? { ...l, itens: l.itens.map((i) => (i.id === item.id ? { ...i, typed } : i)) } : l,
          ),
      )
    aplicar(novo)
    setErro('')
    try {
      const res = await fetch(`/api/convenios/lotes/${lote.id}/itens/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ typed: novo }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        aplicar(!novo)
        setErro(json.error || 'Não foi possível salvar')
        return
      }
      mudou()
    } catch {
      aplicar(!novo)
      setErro('Não foi possível salvar')
    }
  }

  const tirar = async (lote: Lote, item: ItemLote) => {
    setErro('')
    try {
      const res = await fetch(`/api/convenios/lotes/${lote.id}/itens/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remover: true }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setErro(json.error || 'Não foi possível tirar do lote')
        return
      }
      mudou()
      await carregar()
    } catch {
      setErro('Não foi possível tirar do lote')
    }
  }

  if (!lotes) return <p className="text-sm text-[#6B7280]">{erro || 'Carregando...'}</p>

  const today = hoje()
  return (
    <div className="space-y-3">
      <style>{`@media print {
        header, nav, .no-print { display: none !important; }
        .lote-card:not(.print-alvo) { display: none !important; }
        .print-alvo { border: none !important; }
        main { padding: 0 !important; margin: 0 !important; }
      }`}</style>
      {erro && <p className="no-print text-sm text-[#DC2626]">{erro}</p>}
      {lotes.length === 0 && (
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-8 text-center text-sm text-[#6B7280]">
          Nenhum lote. Os lotes aparecem quando há itens de guia prontos para faturar.
        </div>
      )}
      {lotes.map((l) => {
        const aberta = aberto === l.id
        const enviado = l.status !== 'aberto'
        return (
          <section
            key={l.id}
            id={`lote-${l.id}`}
            className={`lote-card bg-white rounded-xl border border-[#E5E7EB] ${aberta ? 'print-alvo' : ''}`}
          >
            <button
              type="button"
              onClick={() => setAberto(aberta ? null : l.id)}
              className="w-full text-left px-4 py-3 flex flex-wrap items-center justify-between gap-2"
            >
              <div>
                <p className="font-semibold text-[#111827]">
                  {l.plan.name} · {mmaaaa(l.period_end)}
                </p>
                <p className="text-xs text-[#6B7280]">
                  Período: {dmy(l.period_start)} a {dmy(l.period_end)} · {textoPrazo(l.due_date, today)}
                </p>
              </div>
              <div className="text-right text-sm">
                <span
                  className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                    enviado ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-[#EFF6FF] text-[#1D4ED8]'
                  }`}
                >
                  {l.status === 'pago' ? 'Pago' : enviado ? 'Enviado' : 'Aberto'}
                </span>
                <p className="text-[#111827] font-medium mt-1">{formatCurrency(l.total)}</p>
              </div>
            </button>

            {aberta && (
              <div className="border-t border-[#E5E7EB] px-4 py-3 space-y-4">
                {enviado && (
                  <p className="text-sm text-[#374151]">
                    Protocolo <strong>{l.protocol}</strong>
                    {l.sent_at ? ` · enviado em ${dmy(l.sent_at.slice(0, 10))}` : ''}
                  </p>
                )}
                {l.itens.length === 0 && <p className="text-sm text-[#6B7280]">Lote sem itens.</p>}
                {agrupar(l.itens).map(([k, g]) => (
                  <div key={k}>
                    <p className="text-sm font-medium text-[#111827]">
                      {g.paciente}
                      <span className="font-normal text-[#6B7280]">
                        {g.carteirinha ? ` · Carteirinha ${g.carteirinha}` : ''}
                        {g.guia ? ` · Guia ${g.guia}` : ''}
                        {g.senha ? ` · Senha ${g.senha}` : ''}
                      </span>
                    </p>
                    <ul className="mt-1 divide-y divide-[#F3F4F6]">
                      {g.itens.map((i) => (
                        <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
                          <label className="flex items-center gap-2 flex-1 min-w-48">
                            <input
                              type="checkbox"
                              checked={i.typed}
                              disabled={enviado}
                              onChange={() => alternarDigitado(l, i)}
                              aria-label="Digitado"
                            />
                            <span className="text-[#111827]">
                              {i.code} · {i.name}
                              {i.teeth.length > 0 && <span className="text-[#6B7280]"> ({dentes(i.teeth)})</span>}
                            </span>
                          </label>
                          <span className="text-xs text-[#6B7280]">{i.executed_at ? dmy(i.executed_at) : ''}</span>
                          {i.atrasado && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[#FEF3C7] text-[#92400E]">
                              Atrasado
                            </span>
                          )}
                          <span className="text-[#111827] w-24 text-right">{formatCurrency(i.value)}</span>
                          {!enviado && (
                            <button
                              type="button"
                              onClick={() => tirar(l, i)}
                              className="no-print text-xs text-[#DC2626] hover:underline"
                            >
                              Tirar do lote
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#F3F4F6]">
                  <p className="text-sm font-semibold text-[#111827]">Total: {formatCurrency(l.total)}</p>
                  <div className="no-print flex gap-2">
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-[#E5E7EB] text-[#374151] hover:bg-[#F9FAFB]"
                    >
                      <Printer className="w-4 h-4" /> Imprimir
                    </button>
                    {!enviado && (
                      <button
                        type="button"
                        onClick={() => setEnviando(l)}
                        disabled={l.itens.length === 0}
                        className="px-3 py-2 text-sm rounded-lg bg-[#3B82F6] text-white hover:bg-[#2563EB] disabled:opacity-50"
                      >
                        Marcar como enviado
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        )
      })}

      {enviando && (
        <ModalEnvio
          lote={enviando}
          onClose={() => setEnviando(null)}
          onSent={async () => {
            setEnviando(null)
            mudou()
            await carregar()
          }}
        />
      )}
    </div>
  )
}

function ModalEnvio({ lote, onClose, onSent }: { lote: Lote; onClose: () => void; onSent: () => void }) {
  const [protocol, setProtocol] = useState('')
  const [sentAt, setSentAt] = useState(hoje())
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')

  const enviar = async () => {
    setLoading(true)
    setErro('')
    try {
      const res = await fetch(`/api/convenios/lotes/${lote.id}/enviar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ protocol, sentAt }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErro(json.error || 'Não foi possível marcar como enviado')
        setLoading(false)
        return
      }
      onSent()
    } catch {
      setErro('Não foi possível marcar como enviado')
      setLoading(false)
    }
  }

  return (
    <div className="no-print fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-sm p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-[#111827]">Marcar como enviado</h2>
          <button type="button" onClick={onClose} aria-label="Fechar">
            <X className="w-5 h-5 text-[#6B7280]" />
          </button>
        </div>
        <p className="text-xs text-[#6B7280]">
          {lote.plan.name} · {mmaaaa(lote.period_end)}. Depois de enviado, o lote fica travado.
        </p>
        <label className="block text-sm text-[#374151]">
          Protocolo
          <input
            value={protocol}
            onChange={(e) => setProtocol(e.target.value)}
            maxLength={60}
            className="mt-1 w-full border border-[#E5E7EB] rounded-lg px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm text-[#374151]">
          Data do envio
          <input
            type="date"
            value={sentAt}
            onChange={(e) => setSentAt(e.target.value)}
            className="mt-1 w-full border border-[#E5E7EB] rounded-lg px-3 py-2 text-sm"
          />
        </label>
        {erro && <p className="text-sm text-[#DC2626]">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded-lg border border-[#E5E7EB]">
            Cancelar
          </button>
          <button
            type="button"
            onClick={enviar}
            disabled={loading}
            className="px-3 py-2 text-sm rounded-lg bg-[#3B82F6] text-white disabled:opacity-50"
          >
            {loading ? 'Salvando...' : 'Confirmar envio'}
          </button>
        </div>
      </div>
    </div>
  )
}
