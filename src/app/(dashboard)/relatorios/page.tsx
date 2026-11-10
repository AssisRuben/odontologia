'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import { mesAnterior, mesDe, rotuloMes } from '@/lib/comissoes/periodo'
import { todayYmd } from '@/lib/messaging/time'
import type { Painel } from '@/lib/indicadores/painel'
import { brl } from '@/components/financeiro/formatoComissao'
import CartaoIndicador, { pctInteiro } from '@/components/relatorios/CartaoIndicador'
import MiniGrafico from '@/components/relatorios/MiniGrafico'
import BlocoAgenda from '@/components/relatorios/BlocoAgenda'
import BlocoFinanceiro from '@/components/relatorios/BlocoFinanceiro'
import BlocoOrcamentos from '@/components/relatorios/BlocoOrcamentos'

function proximoMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const GERAL = 'geral da clínica'
const num = (n: number) => String(n)

export default function RelatoriosPage() {
  const { clinicId } = useClinicStore()
  const [mesAtual] = useState(() => mesDe(todayYmd(new Date(), 'America/Sao_Paulo')))
  const [mes, setMes] = useState(mesAtual)
  const [dentista, setDentista] = useState('')
  const [profissionais, setProfissionais] = useState<{ id: string; name: string }[]>([])
  const [dados, setDados] = useState<Painel | null>(null)
  const [erro, setErro] = useState('')
  const seq = useRef(0)

  useEffect(() => {
    if (!clinicId) return
    let ativo = true
    createClient()
      .from('professionals')
      .select('id, name')
      .eq('clinic_id', clinicId)
      .order('name')
      .then(({ data }) => {
        if (ativo) setProfissionais(data ?? [])
      })
    return () => {
      ativo = false
    }
  }, [clinicId])

  const carregar = useCallback(async (m: string, d: string) => {
    const mine = ++seq.current
    try {
      const qs = new URLSearchParams({ mes: m })
      if (d) qs.set('dentista', d)
      const res = await fetch(`/api/indicadores?${qs}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (mine !== seq.current) return
      if (!res.ok) {
        setErro(json.error || 'Não foi possível carregar os indicadores')
        return
      }
      setErro('')
      setDados(json as Painel)
    } catch {
      if (mine === seq.current) setErro('Não foi possível carregar os indicadores. Verifique a conexão.')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDados(null)
    setErro('')
    carregar(mes, dentista)
  }, [mes, dentista, carregar])

  const filtrado = !!dados?.dentista
  const c = dados?.cartoes

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <h1 className="text-xl font-semibold text-[#111827]">Visão geral</h1>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => setMes(mesAnterior(mes))} aria-label="Mês anterior"
            className="p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280]">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-base font-semibold text-[#111827] w-28 text-center">{rotuloMes(mes)}</span>
          <button onClick={() => setMes(proximoMes(mes))} aria-label="Próximo mês" disabled={mes >= mesAtual}
            className="p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280] disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <select
          value={dentista}
          onChange={(e) => setDentista(e.target.value)}
          aria-label="Dentista"
          className="h-9 px-3 rounded-lg border border-[#E5E7EB] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
        >
          <option value="">Todos os dentistas</option>
          {profissionais.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {dados?.parcial && (
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

      {dados && c && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <CartaoIndicador titulo="Comparecimento" valor={pctInteiro(c.comparecimento.valor)} variacao={c.comparecimento.variacao} />
            <CartaoIndicador titulo="Faltas" valor={num(c.faltas.valor ?? 0)} variacao={c.faltas.variacao} altaEhRuim />
            <CartaoIndicador titulo="Recebido" valor={brl(c.recebido.valor ?? 0)} variacao={c.recebido.variacao} nota={filtrado ? GERAL : undefined} />
            <CartaoIndicador titulo="Ticket médio" valor={c.ticket.valor === null ? '—' : brl(c.ticket.valor)} variacao={c.ticket.variacao} nota={filtrado ? GERAL : undefined} />
            <CartaoIndicador titulo="Aprovação de orçamentos" valor={pctInteiro(c.aprovacao.valor)} variacao={c.aprovacao.variacao} />
            <CartaoIndicador titulo="Pacientes novos" valor={num(c.novos.valor ?? 0)} variacao={c.novos.variacao} nota={filtrado ? GERAL : undefined} />
          </div>
          <p className="text-xs text-[#6B7280] -mt-3">
            {dados.novos.whatsapp} {dados.novos.whatsapp === 1 ? 'paciente novo veio' : 'pacientes novos vieram'} pelo WhatsApp.
          </p>

          <BlocoAgenda agenda={dados.agenda} />
          <BlocoFinanceiro financeiro={dados.financeiro} />
          <BlocoOrcamentos orcamentos={dados.orcamentos} />

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-[#111827]">Tendência (6 meses)</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <MiniGrafico titulo="Comparecimento" pontos={dados.tendencia.map((t) => ({ mes: t.mes, valor: t.comparecimento }))} formato={pctInteiro} />
              <MiniGrafico titulo="Recebido" pontos={dados.tendencia.map((t) => ({ mes: t.mes, valor: t.recebidoCentavos }))} formato={brl} nota={filtrado ? GERAL : undefined} />
              <MiniGrafico titulo="Ticket médio" pontos={dados.tendencia.map((t) => ({ mes: t.mes, valor: t.ticketCentavos }))} formato={brl} nota={filtrado ? GERAL : undefined} />
              <MiniGrafico titulo="Aprovação de orçamentos" pontos={dados.tendencia.map((t) => ({ mes: t.mes, valor: t.aprovacao }))} formato={pctInteiro} />
              <MiniGrafico titulo="Pacientes novos" pontos={dados.tendencia.map((t) => ({ mes: t.mes, valor: t.novos }))} formato={num} nota={filtrado ? GERAL : undefined} />
            </div>
          </section>
        </>
      )}
    </div>
  )
}
