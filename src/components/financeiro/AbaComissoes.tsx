'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ResumoDentista } from '@/lib/comissoes/calculo'
import { mesAnterior, mesDe, rotuloMes } from '@/lib/comissoes/periodo'
import { todayYmd } from '@/lib/messaging/time'
import ModalExtratoComissao from './ModalExtratoComissao'
import ModalPagarComissao from './ModalPagarComissao'
import { brl, dmy } from './formatoComissao'

type Resposta = { mes: string; hoje: string; encerrado: boolean; dentistas: ResumoDentista[] }

function proximoMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const th = 'px-4 py-3 text-left text-xs font-medium text-[#6B7280] uppercase whitespace-nowrap'
const thR = th.replace('text-left', 'text-right')
const tdR = 'px-4 py-3 text-sm text-[#374151] text-right whitespace-nowrap'
const linkBtn = 'text-xs font-medium text-[#3B82F6] hover:underline disabled:opacity-50 whitespace-nowrap'

export default function AbaComissoes() {
  const [mes, setMes] = useState(() => mesAnterior(mesDe(todayYmd(new Date(), 'America/Sao_Paulo'))))
  const [dados, setDados] = useState<Resposta | null>(null)
  const [erro, setErro] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [extratoDe, setExtratoDe] = useState<ResumoDentista | null>(null)
  const [pagarDe, setPagarDe] = useState<ResumoDentista | null>(null)
  const seq = useRef(0)
  const mesRef = useRef(mes)

  const carregar = useCallback(async (m: string) => {
    const mine = ++seq.current
    try {
      const res = await fetch(`/api/comissoes?mes=${m}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (mine !== seq.current) return
      if (!res.ok) { setErro(json.error || 'Não foi possível carregar as comissões'); return }
      setErro('')
      setDados(json as Resposta)
    } catch {
      if (mine === seq.current) setErro('Não foi possível carregar as comissões. Verifique a conexão.')
    }
  }, [])

  useEffect(() => {
    mesRef.current = mes
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDados(null)
    setErro('')
    carregar(mes)
  }, [mes, carregar])

  async function acao(d: ResumoDentista, req: () => Promise<Response>) {
    if (busyId) return
    setBusyId(d.professional_id)
    setErro('')
    try {
      const res = await req()
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setErro(json.error || 'Não foi possível concluir a ação')
      }
    } catch {
      setErro('Não foi possível concluir a ação. Verifique a conexão.')
    }
    await carregar(mesRef.current)
    setBusyId(null)
  }

  const fecharMes = (d: ResumoDentista) =>
    acao(d, () => fetch('/api/comissoes/fechamentos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ professionalId: d.professional_id, mes }),
    }))

  function reabrir(d: ResumoDentista) {
    if (!d.fechamento || !window.confirm(`Reabrir a comissão de ${d.nome} em ${rotuloMes(mes)}?`)) return
    acao(d, () => fetch(`/api/comissoes/fechamentos/${d.fechamento!.id}`, { method: 'DELETE' }))
  }

  function desfazerPagamento(d: ResumoDentista) {
    if (!d.fechamento || !window.confirm(`Desfazer o pagamento da comissão de ${d.nome}? A despesa será apagada.`)) return
    acao(d, () => fetch(`/api/comissoes/fechamentos/${d.fechamento!.id}/pagamento`, { method: 'DELETE' }))
  }

  const totalGeral = dados?.dentistas.reduce((s, d) => s + d.totalCentavos, 0) ?? 0

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-center gap-3">
        <button onClick={() => setMes(mesAnterior(mes))} aria-label="Mês anterior" disabled={!!busyId}
          className="p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280] disabled:opacity-40">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-base font-semibold text-[#111827] w-28 text-center">{rotuloMes(mes)}</span>
        <button onClick={() => setMes(proximoMes(mes))} aria-label="Próximo mês" disabled={!!busyId}
          className="p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280] disabled:opacity-40">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {dados && !dados.encerrado && (
        <p className="text-sm text-[#92400E] bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Mês em andamento: valores parciais
        </p>
      )}
      {erro && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}

      {!dados && !erro && (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {dados && (
        <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-[#E5E7EB]">
              <tr>
                <th className={th}>Dentista</th>
                <th className={thR}>Particular</th>
                <th className={thR}>Convênio</th>
                <th className={thR}>Laboratório</th>
                <th className={thR}>Ajustes</th>
                <th className={thR}>Total</th>
                <th className={th}>Situação</th>
                <th className={th}>Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F3F4F6]">
              {dados.dentistas.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-[#9CA3AF]">Nenhum dentista cadastrado.</td></tr>
              )}
              {dados.dentistas.map((d) => {
                const busy = busyId === d.professional_id
                return (
                  <tr key={d.professional_id}>
                    <td className="px-4 py-3 text-sm font-medium text-[#111827]">{d.nome}</td>
                    {d.semPercentual || d.semInicio ? (
                      <td colSpan={5} className="px-4 py-3 text-sm text-[#92400E]">
                        {d.semPercentual ? 'Sem percentual.' : 'Sem mês inicial.'}{' '}
                        <Link href="/configuracoes/profissionais" className="font-medium text-[#3B82F6] underline">Definir em Configurações</Link>
                      </td>
                    ) : (
                      <>
                        <td className={tdR}>{brl(d.particularBaseCentavos)}</td>
                        <td className={tdR}>{brl(d.convenioBaseCentavos)}</td>
                        <td className={tdR}>{brl(d.laboratorioCustoCentavos)}</td>
                        <td className={tdR}>{brl(d.ajusteCentavos)}</td>
                        <td className={`${tdR} font-semibold text-[#111827]`}>{brl(d.totalCentavos)}</td>
                      </>
                    )}
                    <td className="px-4 py-3 text-sm text-[#374151] whitespace-nowrap">
                      {d.situacao === 'aberto' && 'Aberto'}
                      {d.situacao === 'fechado' && 'Fechado'}
                      {d.situacao === 'pago' && `Pago em ${d.fechamento?.paid_at ? dmy(d.fechamento.paid_at).slice(0, 5) : ''}`}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        <button className={linkBtn} onClick={() => setExtratoDe(d)}>Ver extrato</button>
                        {d.situacao === 'aberto' && dados.encerrado && d.totalCentavos > 0 && (
                          <button className={linkBtn} disabled={!!busyId} onClick={() => fecharMes(d)}>
                            {busy ? 'Fechando...' : 'Fechar mês'}
                          </button>
                        )}
                        {d.situacao === 'fechado' && (
                          <>
                            <button className={linkBtn} disabled={!!busyId} onClick={() => setPagarDe(d)}>Marcar como pago</button>
                            <button className={linkBtn} disabled={!!busyId} onClick={() => reabrir(d)}>Reabrir</button>
                          </>
                        )}
                        {d.situacao === 'pago' && (
                          <button className={linkBtn} disabled={!!busyId} onClick={() => desfazerPagamento(d)}>Desfazer pagamento</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="border-t border-[#E5E7EB]">
              <tr>
                <td colSpan={5} className="px-4 py-3 text-sm font-semibold text-[#111827]">Total geral</td>
                <td className="px-4 py-3 text-sm font-bold text-[#111827] text-right whitespace-nowrap">{brl(totalGeral)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {extratoDe && (
        <ModalExtratoComissao
          professionalId={extratoDe.professional_id}
          nome={extratoDe.nome}
          mes={mes}
          fechadoEm={extratoDe.fechamento?.closed_at ?? null}
          onClose={() => setExtratoDe(null)}
        />
      )}
      {pagarDe?.fechamento && (
        <ModalPagarComissao
          fechamentoId={pagarDe.fechamento.id}
          nome={pagarDe.nome}
          mes={mes}
          totalCentavos={pagarDe.totalCentavos}
          onClose={() => setPagarDe(null)}
          onPaid={() => { setPagarDe(null); carregar(mes) }}
        />
      )}
    </div>
  )
}
