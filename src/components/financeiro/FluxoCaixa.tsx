'use client'

import { useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { Fluxo } from '@/lib/fluxo/calcular'
import { formatCurrency } from '@/lib/utils'
import GraficoFluxo, { rotuloMes } from './GraficoFluxo'
import ModalSaldo from './ModalSaldo'

type FluxoResp = Fluxo & { saldoInformado: { data: string; valorCentavos: number } | null }

const RED = 'text-[#EF4444]'
const brl = (c: number) => formatCurrency(c / 100)
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const dma = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const neg = (c: number) => (c < 0 ? RED : 'text-tinta')
const mesAno = (mes: string) => {
  const [y, m] = mes.split('-').map(Number)
  return format(new Date(y, m - 1, 1), 'MMMM/yyyy', { locale: ptBR })
}

export default function FluxoCaixa({ onVerPainel }: { onVerPainel: () => void }) {
  const [fluxo, setFluxo] = useState<FluxoResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [modal, setModal] = useState(false)
  const [aberto, setAberto] = useState<string | null>(null)

  useEffect(() => {
    let cancel = false
    async function load() {
      try {
        const res = await fetch('/api/financeiro/fluxo')
        if (!res.ok) throw new Error('falha')
        const json = (await res.json()) as FluxoResp
        if (cancel) return
        setFluxo(json)
        setError(false)
      } catch {
        if (!cancel) setError(true)
      } finally {
        if (!cancel) setLoading(false)
      }
    }
    load()
    return () => { cancel = true }
  }, [reloadKey])

  function recarregar() {
    setLoading(true)
    setError(false)
    setReloadKey((k) => k + 1)
  }

  if (loading && !fluxo) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-petroleo border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !fluxo) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-sm text-tinta-3">
        <p>Não foi possível carregar o fluxo de caixa.</p>
        <button onClick={recarregar}
          className="h-9 px-4 rounded-lg border border-linha text-sm font-medium text-tinta-2 hover:bg-porcelana">
          Tentar de novo
        </button>
      </div>
    )
  }

  const ultimo = fluxo.meses[fluxo.meses.length - 1]
  const menor = fluxo.menorSaldo
  const mesAberto = fluxo.meses.find((m) => m.mes === aberto) ?? null

  return (
    <div className="space-y-4 sm:space-y-6 max-w-5xl">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-linha p-5">
          <p className="text-xs text-tinta-3 mb-1">Saldo hoje</p>
          <p className={`text-2xl font-bold ${neg(fluxo.saldoHojeCentavos)}`}>{brl(fluxo.saldoHojeCentavos)}</p>
        </div>
        <div className="bg-white rounded-xl border border-linha p-5">
          <p className="text-xs text-tinta-3 mb-1">Saldo previsto em {ultimo ? mesAno(ultimo.mes) : ''}</p>
          <p className={`text-2xl font-bold ${neg(fluxo.saldoFinalPrevistoCentavos)}`}>{brl(fluxo.saldoFinalPrevistoCentavos)}</p>
        </div>
        <div className="bg-white rounded-xl border border-linha p-5">
          <p className="text-xs text-tinta-3 mb-1">Menor saldo previsto</p>
          <p className={`text-2xl font-bold ${neg(menor.valorCentavos)}`}>{brl(menor.valorCentavos)}</p>
          <p className="text-xs text-tinta-3 mt-1">em {dm(menor.data)}</p>
          {menor.valorCentavos < 0 && (
            <p className={`text-xs font-medium mt-1 ${RED}`}>O caixa fica negativo em {dm(menor.data)}</p>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-linha p-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-tinta-2">
          {fluxo.saldoInformado
            ? <>Saldo informado: <span className={`font-semibold ${neg(fluxo.saldoInformado.valorCentavos)}`}>{brl(fluxo.saldoInformado.valorCentavos)}</span> em {dma(fluxo.saldoInformado.data)}</>
            : 'Informe o saldo da conta da clínica para o fluxo partir do valor real. Sem ele, o fluxo parte de R$ 0,00.'}
        </p>
        <button onClick={() => setModal(true)}
          className="h-9 px-4 rounded-lg bg-petroleo text-white text-sm font-medium hover:bg-petroleo-escuro">
          Informar saldo
        </button>
      </div>

      <GraficoFluxo meses={fluxo.meses} />

      <div className="bg-white rounded-xl border border-linha overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-tinta-3 border-b border-linha">
              <th className="px-4 py-3 font-medium">Mês</th>
              <th className="px-4 py-3 font-medium text-right">Saldo inicial</th>
              <th className="px-4 py-3 font-medium text-right">Entradas</th>
              <th className="px-4 py-3 font-medium text-right">Saídas</th>
              <th className="px-4 py-3 font-medium text-right">Saldo final</th>
            </tr>
          </thead>
          <tbody>
            {fluxo.meses.map((m) => {
              const open = aberto === m.mes
              return (
                <tr key={m.mes} onClick={() => setAberto(open ? null : m.mes)}
                  className={`border-b border-porcelana cursor-pointer hover:bg-porcelana/60 ${open ? 'bg-porcelana/60' : ''}`}>
                  <td className="px-4 py-3 text-tinta">
                    <button type="button" aria-expanded={open} className="text-left">
                      <span className="capitalize">{rotuloMes(m.mes)}</span>
                      {m.situacao === 'previsto' && <span className="ml-2 text-xs text-tinta-4">previsto</span>}
                    </button>
                  </td>
                  <td className={`px-4 py-3 text-right ${neg(m.saldoInicialCentavos)}`}>{brl(m.saldoInicialCentavos)}</td>
                  <td className="px-4 py-3 text-right text-tinta-2">{brl(m.entradasCentavos)}</td>
                  <td className="px-4 py-3 text-right text-tinta-2">{brl(m.saidasCentavos)}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${neg(m.saldoFinalCentavos)}`}>{brl(m.saldoFinalCentavos)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {fluxo.emAtraso.quantidade > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-tinta-2 bg-white rounded-xl border border-linha px-4 py-3">
          <AlertCircle className={`w-4 h-4 ${RED}`} />
          <span>{brl(fluxo.emAtraso.totalCentavos)} em {fluxo.emAtraso.quantidade} cobranças vencidas — não entram no saldo.</span>
          <button onClick={onVerPainel} className="font-medium text-petroleo underline">Ver no Painel</button>
        </div>
      )}

      {mesAberto && (
        <div className="bg-white rounded-xl border border-linha p-5">
          <h3 className="font-semibold text-tinta mb-3 capitalize">Dia a dia — {mesAno(mesAberto.mes)}</h3>
          {mesAberto.dias.length === 0 ? (
            <p className="text-sm text-tinta-4">Nenhum movimento neste mês.</p>
          ) : (
            <div className="space-y-4">
              {mesAberto.dias.map((d) => (
                <div key={d.data}>
                  <div className="flex justify-between text-sm font-semibold text-tinta-2 mb-1">
                    <span>{dma(d.data)}</span>
                    <span className={neg(d.saldoFinalCentavos)}>Saldo: {brl(d.saldoFinalCentavos)}</span>
                  </div>
                  <ul className="space-y-0.5">
                    {d.movimentos.map((mv, i) => (
                      <li key={i} className="flex justify-between gap-3 text-sm">
                        <span className="text-tinta-2">
                          {mv.descricao}
                          {mv.previsto && <span className="ml-2 text-xs text-tinta-4">previsto</span>}
                        </span>
                        <span className={mv.tipo === 'entrada' ? 'text-[#10B981]' : RED}>
                          {mv.tipo === 'entrada' ? '+' : '-'}{brl(Math.abs(mv.valorCentavos))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {modal && <ModalSaldo onClose={() => setModal(false)} onSaved={recarregar} />}
    </div>
  )
}
