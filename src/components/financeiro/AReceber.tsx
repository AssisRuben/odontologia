'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import { formatCurrency } from '@/lib/utils'
import { todayYmd } from '@/lib/messaging/time'
import { agruparReceber } from '@/lib/receber/agrupar'
import type { ItemReceber, Lembrete, TipoReceber } from '@/lib/receber/agrupar'
import type { Payment, FiscalInvoice } from '@/types'
import ListaPagamentos from '@/components/pagamentos/ListaPagamentos'

const PAGE = 1000
const CHUNK = 200

const TIPOS: { value: TipoReceber; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'boleto', label: 'Boleto/carnê' },
  { value: 'link', label: 'Pix/link' },
  { value: 'cartao', label: 'Cartão parcelado' },
  { value: 'manual', label: 'Lançamento manual' },
]

const cobrancas = (n: number) => `${n} ${n === 1 ? 'cobrança' : 'cobranças'}`
const dias = (n: number) => `${n} ${n === 1 ? 'dia' : 'dias'}`
const reais = (centavos: number) => formatCurrency(centavos / 100)
const ddmm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export default function AReceber() {
  const { clinicId } = useClinicStore()
  const [payments, setPayments] = useState<Payment[]>([])
  const [invoices, setInvoices] = useState<FiscalInvoice[]>([])
  const [lembretes, setLembretes] = useState<Lembrete[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [busca, setBusca] = useState('')
  const [tipo, setTipo] = useState<TipoReceber>('todos')

  useEffect(() => {
    if (!clinicId) return
    let stale = false
    async function load() {
      try {
        const supabase = createClient()
        const pays: Payment[] = []
        for (let from = 0; ; from += PAGE) {
          const r = await supabase.from('payments').select('*, patient:patients(name)')
            .eq('clinic_id', clinicId!)
            .in('status', ['pending', 'overdue'])
            .or('payment_method.is.null,payment_method.neq.convenio')
            .order('id')
            .range(from, from + PAGE - 1)
          if (r.error) throw r.error
          const rows = (r.data as Payment[]) || []
          pays.push(...rows)
          if (rows.length < PAGE) break
        }
        async function carregarLembretes(bloco: string[]): Promise<Lembrete[]> {
          const out: Lembrete[] = []
          for (let from = 0; ; from += PAGE) {
            const r = await supabase.from('messages').select('payment_id, type, sent_at')
              .eq('clinic_id', clinicId!)
              .in('payment_id', bloco)
              .eq('status', 'sent')
              .eq('direction', 'out')
              .in('type', ['charge', 'payment_due', 'manual'])
              .order('id')
              .range(from, from + PAGE - 1)
            if (r.error) throw r.error
            const rows = (r.data as Lembrete[]) || []
            out.push(...rows)
            if (rows.length < PAGE) break
          }
          return out
        }
        const inv: FiscalInvoice[] = []
        const lem: Lembrete[] = []
        for (const bloco of chunks(pays.map(p => p.id), CHUNK)) {
          const [ri, rl] = await Promise.all([
            supabase.from('fiscal_invoices').select('*').in('payment_id', bloco),
            carregarLembretes(bloco),
          ])
          if (ri.error) throw ri.error
          inv.push(...((ri.data as FiscalInvoice[]) || []))
          lem.push(...rl)
        }
        if (stale) return
        setPayments(pays)
        setInvoices(inv)
        setLembretes(lem)
        setError(false)
      } catch (e) {
        console.error('[AReceber] falha ao carregar:', e)
        if (!stale) setError(true)
      } finally {
        if (!stale) setLoading(false)
      }
    }
    load()
    return () => { stale = true }
  }, [clinicId, reloadKey])

  function recarregar() {
    setReloadKey(k => k + 1)
  }

  function tentarDeNovo() {
    setError(false)
    setLoading(true)
    recarregar()
  }

  const hoje = todayYmd(new Date(), 'America/Sao_Paulo')
  const receber = useMemo(
    () => agruparReceber({ hoje, pagamentos: payments, lembretes, filtro: { busca, tipo } }),
    [hoje, payments, lembretes, busca, tipo],
  )
  const itensPorId = useMemo(() => {
    const m = new Map<string, ItemReceber>()
    for (const g of [receber.grupos.atraso, receber.grupos.proximos, receber.grupos.depois]) {
      for (const i of g) m.set(i.pagamento.id, i)
    }
    return m
  }, [receber])

  const filtrando = busca.trim() !== '' || tipo !== 'todos'

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-petroleo border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-sm text-tinta-3">
        <p>Não foi possível carregar as cobranças em aberto.</p>
        <button onClick={tentarDeNovo}
          className="h-10 px-4 rounded-lg bg-petroleo hover:bg-petroleo-escuro text-white text-sm font-medium">
          Tentar de novo
        </button>
      </div>
    )
  }

  function linhaExtra(p: Payment, grupoAtraso: boolean) {
    const item = itensPorId.get(p.id)
    if (!item) return null
    return (
      <div className="text-xs mt-0.5 space-y-0.5">
        {grupoAtraso && item.diasAtraso !== null && (
          <p className="text-[#EF4444]">Atrasada há {dias(item.diasAtraso)}</p>
        )}
        <p className="text-tinta-3">
          {item.ultimoLembrete
            ? `Último lembrete: ${ddmm(item.ultimoLembrete.data)} (${item.ultimoLembrete.tipo === 'manual' ? 'manual' : 'automático'})`
            : 'Nenhum lembrete enviado'}
        </p>
      </div>
    )
  }

  const grupos: { chave: 'atraso' | 'proximos' | 'depois'; titulo: string; itens: ItemReceber[]; total: { totalCentavos: number; quantidade: number } }[] = [
    { chave: 'atraso', titulo: 'Em atraso', itens: receber.grupos.atraso, total: receber.totais.atraso },
    { chave: 'proximos', titulo: 'Próximos 7 dias', itens: receber.grupos.proximos, total: receber.totais.proximos },
    {
      chave: 'depois', titulo: 'Depois', itens: receber.grupos.depois,
      total: {
        quantidade: receber.grupos.depois.length,
        totalCentavos: receber.totais.total.totalCentavos - receber.totais.atraso.totalCentavos - receber.totais.proximos.totalCentavos,
      },
    },
  ]

  const inputCls = 'h-10 px-3 rounded-lg border border-linha text-sm bg-white focus:outline-none focus:ring-2 focus:ring-petroleo'

  return (
    <div className="space-y-4 sm:space-y-6 max-w-5xl">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-linha p-5">
          <p className="text-sm text-tinta-3 mb-1">Em atraso</p>
          <p className="text-2xl font-bold text-[#EF4444]">{reais(receber.totais.atraso.totalCentavos)}</p>
          <p className="text-sm text-tinta-3 mt-0.5">{cobrancas(receber.totais.atraso.quantidade)}</p>
        </div>
        <div className="bg-white rounded-xl border border-linha p-5">
          <p className="text-sm text-tinta-3 mb-1">Vence nos próximos 7 dias</p>
          <p className="text-2xl font-bold text-tinta">{reais(receber.totais.proximos.totalCentavos)}</p>
          <p className="text-sm text-tinta-3 mt-0.5">{cobrancas(receber.totais.proximos.quantidade)}</p>
        </div>
        <div className="bg-white rounded-xl border border-linha p-5">
          <p className="text-sm text-tinta-3 mb-1">Total a receber</p>
          <p className="text-2xl font-bold text-tinta">{reais(receber.totais.total.totalCentavos)}</p>
          <p className="text-sm text-tinta-3 mt-0.5">{cobrancas(receber.totais.total.quantidade)}</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="search"
          aria-label="Buscar paciente"
          placeholder="Buscar paciente"
          value={busca}
          onChange={e => setBusca(e.target.value)}
          className={`${inputCls} flex-1`}
        />
        <select
          aria-label="Tipo"
          value={tipo}
          onChange={e => setTipo(e.target.value as TipoReceber)}
          className={`${inputCls} sm:w-56`}
        >
          {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      {receber.vazio ? (
        <div className="flex items-center justify-center py-16 text-tinta-4 text-sm">
          {filtrando ? 'Nenhuma cobrança encontrada com esses filtros.' : 'Nenhuma cobrança em aberto.'}
        </div>
      ) : (
        grupos.filter(g => g.itens.length > 0).map(g => (
          <div key={g.chave} className="bg-white rounded-xl border border-linha overflow-hidden">
            <h3 className="px-5 py-4 border-b border-linha font-semibold text-tinta">
              {g.titulo} <span className="font-normal text-tinta-3">· {cobrancas(g.total.quantidade)} · {reais(g.total.totalCentavos)}</span>
            </h3>
            <ListaPagamentos
              payments={g.itens.map(i => i.pagamento)}
              invoices={invoices}
              showPatient
              onChanged={recarregar}
              extra={p => linhaExtra(p, g.chave === 'atraso')}
            />
          </div>
        ))
      )}
    </div>
  )
}
