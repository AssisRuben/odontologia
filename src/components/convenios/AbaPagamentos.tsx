'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatCurrency } from '@/lib/utils'
import { todayYmd } from '@/lib/messaging/time'
import { diasEntre } from '@/lib/convenios/periodo'
import { rotuloSituacao, situacaoPagamento } from '@/lib/convenios/pagamentos/situacao'
import type { Pagamentos } from '@/lib/convenios/repo'
import { ModalPagamentoLote, type ItemPagamentoLote } from './ModalPagamentoLote'
import { ModalRecurso, type AcaoRecurso } from './ModalRecurso'

type Glosa = Pagamentos['glosas'][number]
type LoteAguardando = Pagamentos['aguardando'][number]

const dmy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`
const mmaaaa = (ymd: string) => `${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`
const dias = (n: number) => `${n} ${n === 1 ? 'dia' : 'dias'}`

function textoPrazoRecurso(prazo: string, hoje: string): string {
  const n = diasEntre(hoje, prazo)
  const quando = n > 0 ? `faltam ${dias(n)}` : n === 0 ? 'vence hoje' : `vencido há ${dias(-n)}`
  return `Prazo de recurso: ${dmy(prazo)} (${quando})`
}

const BTN = 'px-3 py-1.5 text-sm rounded-lg border border-[#E5E7EB] text-[#374151] hover:bg-[#F9FAFB]'
const BTN_PRIMARIO = 'px-3 py-1.5 text-sm rounded-lg bg-[#3B82F6] text-white hover:bg-[#2563EB] disabled:opacity-50'
const CARD = 'bg-white rounded-xl border border-[#E5E7EB] divide-y divide-[#F3F4F6]'

export function AbaPagamentos() {
  const [dados, setDados] = useState<Pagamentos | null>(null)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [pagando, setPagando] = useState<{ lote: LoteAguardando; itens: ItemPagamentoLote[] } | null>(null)
  const [recurso, setRecurso] = useState<{ acao: AcaoRecurso; glosa: Glosa } | null>(null)

  const carregar = useCallback(async () => {
    try {
      const res = await fetch('/api/convenios/pagamentos', { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErro(json.error || 'Não foi possível carregar os pagamentos')
        return
      }
      setErro('')
      setDados(json)
    } catch {
      setErro('Não foi possível carregar os pagamentos')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregar()
  }, [carregar])

  const abrirPagamento = async (lote: LoteAguardando) => {
    setOcupado(lote.id)
    setErro('')
    setAviso('')
    try {
      const res = await fetch('/api/convenios/lotes', { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErro(json.error || 'Não foi possível carregar os itens do lote')
        return
      }
      const achado = (json.lotes ?? []).find((l: { id: string }) => l.id === lote.id) as
        | { itens: ItemPagamentoLote[] }
        | undefined
      if (!achado) {
        setErro('Não foi possível carregar os itens do lote')
        return
      }
      setPagando({
        lote,
        itens: achado.itens.map((i) => ({
          id: i.id,
          patient_name: i.patient_name,
          code: i.code,
          name: i.name,
          value: i.value,
        })),
      })
    } catch {
      setErro('Não foi possível carregar os itens do lote')
    } finally {
      setOcupado(null)
    }
  }

  const desfazer = async (id: string, plano: string, periodEnd: string, temRecurso: boolean) => {
    const recursos = temRecurso ? ' Recursos registrados neste lote também serão apagados.' : ''
    if (
      !window.confirm(
        `Desfazer o pagamento do lote ${plano} ${mmaaaa(periodEnd)}? Os recebimentos lançados serão cancelados.${recursos}`,
      )
    ) {
      return
    }
    setOcupado(id)
    setErro('')
    setAviso('')
    try {
      const res = await fetch(`/api/convenios/lotes/${id}/pagamento`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErro(json.error || 'Não foi possível desfazer o pagamento')
        return
      }
      window.dispatchEvent(new Event('convenios:changed'))
      await carregar()
    } catch {
      setErro('Não foi possível desfazer o pagamento')
    } finally {
      setOcupado(null)
    }
  }

  if (!dados) return <p className="text-sm text-[#6B7280]">{erro || 'Carregando...'}</p>

  const hoje = todayYmd(new Date(), 'America/Sao_Paulo')
  return (
    <div className="space-y-6">
      {erro && <p className="text-sm text-[#DC2626]">{erro}</p>}
      {aviso && <p className="text-sm text-[#92400E] bg-[#FEF3C7] rounded-lg px-3 py-2">{aviso}</p>}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-[#111827]">Aguardando pagamento</h2>
        {dados.aguardando.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#E5E7EB] p-6 text-center text-sm text-[#6B7280]">
            Nenhum lote aguardando pagamento.
          </div>
        ) : (
          <div className={CARD}>
            {dados.aguardando.map((l) => (
              <div key={l.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-[#111827]">
                    {l.plan_name} · {mmaaaa(l.period_end)}
                    {l.atrasado && (
                      <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-[#FEF3C7] text-[#92400E]">
                        Atrasado
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-[#6B7280]">
                    Enviado em {dmy(l.sent_at.slice(0, 10))}
                    {l.protocol ? ` · protocolo ${l.protocol}` : ''} · previsto para {dmy(l.data_prevista)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-[#111827]">{formatCurrency(l.total)}</span>
                  <button type="button" onClick={() => abrirPagamento(l)} disabled={ocupado === l.id} className={BTN_PRIMARIO}>
                    Registrar pagamento
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-[#111827]">Glosas</h2>
        {dados.glosas.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#E5E7EB] p-6 text-center text-sm text-[#6B7280]">
            Nenhuma glosa em aberto.
          </div>
        ) : (
          <div className={CARD}>
            {dados.glosas.map((g) => {
              const situacao = rotuloSituacao(
                situacaoPagamento({
                  paid_value: 0,
                  glosa_value: g.glosa_value,
                  appeal_status: g.appeal_status,
                  recovered_value: g.recovered_value,
                  recovered_payment_id: null,
                }),
              )
              return (
                <div key={g.item_id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-48 flex-1">
                    <p className="font-medium text-[#111827]">
                      {g.patient_name} · {g.code} · {g.name}
                    </p>
                    <p className="text-xs text-[#6B7280]">
                      {g.glosa_code ? `Motivo ${g.glosa_code}${g.glosa_reason ? ` — ${g.glosa_reason}` : ''}` : 'Sem motivo'}
                      {g.glosa_note ? ` · ${g.glosa_note}` : ''}
                    </p>
                    <p className="text-xs text-[#6B7280]">
                      {g.appeal_status === 'nenhum'
                        ? textoPrazoRecurso(g.prazo_recurso, hoje)
                        : `${situacao}${g.appeal_at ? ` · recurso em ${dmy(g.appeal_at)}` : ''}${
                            g.appeal_status === 'aceito' && g.recovered_value !== null
                              ? ` · a receber ${formatCurrency(g.recovered_value)}`
                              : ''
                          }`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-[#DC2626]">{formatCurrency(g.glosa_value)}</span>
                    {g.appeal_status === 'nenhum' && (
                      <button type="button" onClick={() => setRecurso({ acao: 'recorrer', glosa: g })} className={BTN}>
                        Recorrer
                      </button>
                    )}
                    {g.appeal_status === 'em_recurso' && (
                      <button type="button" onClick={() => setRecurso({ acao: 'resultado', glosa: g })} className={BTN}>
                        Resultado
                      </button>
                    )}
                    {g.appeal_status === 'aceito' && (
                      <button type="button" onClick={() => setRecurso({ acao: 'recebimento', glosa: g })} className={BTN}>
                        Registrar recebimento
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-[#111827]">Pagos (últimos 6 meses)</h2>
        {dados.pagos.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#E5E7EB] p-6 text-center text-sm text-[#6B7280]">
            Nenhum lote pago neste período.
          </div>
        ) : (
          <div className={CARD}>
            {dados.pagos.map((l) => (
              <div key={l.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-[#111827]">
                    {l.plan_name} · {mmaaaa(l.period_end)}
                  </p>
                  <p className="text-xs text-[#6B7280]">
                    Pago em {dmy(l.paid_at.slice(0, 10))} · enviado {formatCurrency(l.totais.enviado)} · pago{' '}
                    {formatCurrency(l.totais.pago)} · glosado {formatCurrency(l.totais.glosado)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => desfazer(l.id, l.plan_name, l.period_end, l.tem_recurso)}
                  disabled={ocupado === l.id}
                  className="text-sm text-[#DC2626] hover:underline disabled:opacity-50"
                >
                  Desfazer pagamento
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {pagando && (
        <ModalPagamentoLote
          lote={{ id: pagando.lote.id, plano: pagando.lote.plan_name, periodEnd: pagando.lote.period_end }}
          itens={pagando.itens}
          onClose={() => setPagando(null)}
          onSaved={async () => {
            setPagando(null)
            await carregar()
          }}
        />
      )}
      {recurso && (
        <ModalRecurso
          acao={recurso.acao}
          glosa={recurso.glosa}
          onClose={() => setRecurso(null)}
          onSaved={async (a) => {
            setRecurso(null)
            setAviso(a ?? '')
            await carregar()
          }}
        />
      )}
    </div>
  )
}
