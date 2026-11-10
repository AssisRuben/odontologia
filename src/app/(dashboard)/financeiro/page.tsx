'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { TrendingUp, TrendingDown, DollarSign, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react'
import { format, startOfMonth, endOfMonth, addMonths, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import { formatCurrency } from '@/lib/utils'
import type { Payment, Expense, FiscalInvoice } from '@/types'
import AsaasBanner from '@/components/pagamentos/AsaasBanner'
import ListaPagamentos from '@/components/pagamentos/ListaPagamentos'
import ListaDespesas from '@/components/financeiro/ListaDespesas'
import LivroCaixa from '@/components/financeiro/LivroCaixa'
import AbaComissoes from '@/components/financeiro/AbaComissoes'
import { categoryLabel } from '@/lib/livro-caixa/categorias'

type Tab = 'painel' | 'fluxo' | 'boletos' | 'comissoes' | 'despesas' | 'livro'

export default function FinanceiroPage() {
  const { clinicId, loading: clinicLoading } = useClinicStore()
  const [activeTab, setActiveTab] = useState<Tab>('painel')
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [payments, setPayments] = useState<Payment[]>([])
  const [invoices, setInvoices] = useState<FiscalInvoice[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  const loadedMonth = useRef<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [invoiceError, setInvoiceError] = useState(false)

  useEffect(() => {
    if (!clinicId) return
    let stale = false
    async function load() {
      const supabase = createClient()
      const start = format(startOfMonth(currentMonth), 'yyyy-MM-dd')
      // recarga após uma ação mantém a lista na tela (não perde avisos e janelas abertas)
      if (loadedMonth.current !== start) setLoading(true)
      const end = format(endOfMonth(currentMonth), 'yyyy-MM-dd')
      try {
        const [paymentsRes, expensesRes] = await Promise.all([
          supabase.from('payments').select('*, patient:patients(name)').eq('clinic_id', clinicId!)
            .gte('due_date', start).lte('due_date', end),
          supabase.from('expenses').select('*').eq('clinic_id', clinicId!)
            .gte('due_date', start).lte('due_date', end),
        ])
        const loaded: Payment[] = paymentsRes.data || []
        let inv: FiscalInvoice[] = []
        let invErr = false
        if (loaded.length > 0) {
          const r = await supabase.from('fiscal_invoices').select('*').in('payment_id', loaded.map(p => p.id))
          if (r.error) invErr = true
          else inv = (r.data as FiscalInvoice[]) || []
        }
        if (stale) return
        setPayments(loaded)
        setInvoices(inv)
        setInvoiceError(invErr)
        setExpenses(expensesRes.data || [])
        loadedMonth.current = start
      } finally {
        if (!stale) setLoading(false)
      }
    }
    load()
    return () => { stale = true }
  }, [clinicId, currentMonth, reloadKey])

  const sortedPayments = useMemo(
    () => [...payments].sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '')),
    [payments],
  )

  const recebido    = payments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0)
  const aReceber    = payments.filter((p) => p.status === 'pending').reduce((s, p) => s + p.amount, 0)
  const totalEntradas = recebido + aReceber
  const pago        = expenses.filter((e) => e.status === 'paid').reduce((s, e) => s + e.amount, 0)
  const aPagar      = expenses.filter((e) => e.status === 'pending').reduce((s, e) => s + e.amount, 0)
  const totalSaidas = pago + aPagar
  const resultado   = recebido - pago
  const inadimplentes = payments.filter((p) => p.status === 'overdue')

  const tabs: { id: Tab; label: string }[] = [
    { id: 'painel', label: 'Painel' },
    { id: 'fluxo', label: 'Fluxo de caixa' },
    { id: 'boletos', label: 'Boletos' },
    { id: 'comissoes', label: 'Comissões' },
    { id: 'despesas', label: 'Despesas' },
    { id: 'livro', label: 'Livro-caixa' },
  ]

  if (clinicLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)]">
        <div className="w-8 h-8 border-2 border-petroleo border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col">
      <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-3">
        <h1 className="text-2xl sm:text-[26px] font-semibold text-tinta leading-tight">Financeiro</h1>
      </div>
      <AsaasBanner />

      <div className="border-b border-linha px-2 sm:px-6 overflow-x-auto">
        <div className="flex min-w-max">
          {tabs.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id ? 'border-petroleo text-petroleo' : 'border-transparent text-tinta-3 hover:text-tinta'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-6">
        {activeTab === 'painel' && (
          <div className="space-y-4 sm:space-y-6 max-w-5xl">
            {/* Seletor de mês */}
            <div className="flex items-center gap-3">
              <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                className="p-1.5 rounded-lg hover:bg-porcelana text-tinta-3">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-base font-semibold text-tinta capitalize w-44 text-center">
                {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}
              </span>
              <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                className="p-1.5 rounded-lg hover:bg-porcelana text-tinta-3">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-6 h-6 border-2 border-petroleo border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                {/* Cards de visão geral */}
                <div>
                  <h2 className="text-sm font-semibold text-tinta-3 uppercase tracking-wide mb-3">Visão Geral</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="bg-white rounded-xl border border-linha p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                          <TrendingUp className="w-4 h-4 text-[#10B981]" />
                        </div>
                        <span className="font-semibold text-tinta">Entradas</span>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-tinta-3">Recebido</span>
                          <span className="font-semibold text-[#10B981]">{formatCurrency(recebido)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-tinta-3">A receber</span>
                          <span className="font-medium text-tinta-2">{formatCurrency(aReceber)}</span>
                        </div>
                        <div className="border-t border-linha pt-2 flex justify-between text-sm">
                          <span className="text-tinta-3">Total previsto</span>
                          <span className="font-bold text-tinta">{formatCurrency(totalEntradas)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border border-linha p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
                          <TrendingDown className="w-4 h-4 text-[#EF4444]" />
                        </div>
                        <span className="font-semibold text-tinta">Saídas</span>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-tinta-3">Pago</span>
                          <span className="font-semibold text-[#EF4444]">{formatCurrency(pago)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-tinta-3">A pagar</span>
                          <span className="font-medium text-tinta-2">{formatCurrency(aPagar)}</span>
                        </div>
                        <div className="border-t border-linha pt-2 flex justify-between text-sm">
                          <span className="text-tinta-3">Total previsto</span>
                          <span className="font-bold text-tinta">{formatCurrency(totalSaidas)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border border-linha p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-8 h-8 bg-petroleo-100 rounded-lg flex items-center justify-center">
                          <DollarSign className="w-4 h-4 text-petroleo" />
                        </div>
                        <span className="font-semibold text-tinta">Resultado</span>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <p className="text-xs text-tinta-3 mb-1">Líquido realizado</p>
                          <p className={`text-2xl font-bold ${resultado >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                            {formatCurrency(resultado)}
                          </p>
                        </div>
                        <div className="flex justify-between text-sm border-t border-linha pt-2">
                          <span className="text-tinta-3">Previsão</span>
                          <span className="font-medium text-tinta-2">{formatCurrency(totalEntradas - totalSaidas)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Inadimplência */}
                {inadimplentes.length > 0 && (
                  <div className="bg-white rounded-xl border border-linha p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertCircle className="w-5 h-5 text-[#EF4444]" />
                      <h3 className="font-semibold text-tinta">Total de inadimplência</h3>
                    </div>
                    <div className="flex items-center gap-6">
                      <div>
                        <p className="text-2xl font-bold text-[#EF4444]">
                          {formatCurrency(inadimplentes.reduce((s, p) => s + p.amount, 0))}
                        </p>
                        <p className="text-sm text-tinta-3 mt-0.5">{inadimplentes.length} pagamento(s) em atraso</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Próximas despesas */}
                {expenses.filter((e) => e.status === 'pending').length > 0 && (
                  <div className="bg-white rounded-xl border border-linha p-5">
                    <h3 className="font-semibold text-tinta mb-3">Próximas despesas</h3>
                    <div className="space-y-2">
                      {expenses.filter((e) => e.status === 'pending').map((exp) => (
                        <div key={exp.id} className="flex items-center justify-between py-2 border-b border-porcelana last:border-0">
                          <div>
                            <p className="text-sm font-medium text-tinta">{exp.description}</p>
                            <p className="text-xs text-tinta-4">{categoryLabel(exp.category)} · Vence {exp.due_date ? format(new Date(exp.due_date), 'dd/MM/yyyy') : '—'}</p>
                          </div>
                          <span className="text-sm font-semibold text-[#EF4444]">{formatCurrency(exp.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {payments.length > 0 && (
                  <div className="bg-white rounded-xl border border-linha overflow-hidden">
                    <h3 className="px-5 py-4 border-b border-linha font-semibold text-tinta">Lançamentos do mês</h3>
                    {invoiceError && <p className="px-5 py-2 text-xs text-red-600">Não foi possível carregar as notas fiscais.</p>}
                    <ListaPagamentos
                      payments={sortedPayments}
                      invoices={invoices}
                      showPatient
                      onChanged={() => setReloadKey(k => k + 1)}
                    />
                  </div>
                )}

                {payments.length === 0 && expenses.length === 0 && (
                  <div className="flex items-center justify-center py-16 text-tinta-4 text-sm">
                    Nenhum lançamento neste mês.
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'comissoes' && <AbaComissoes />}

        {activeTab === 'despesas' && <ListaDespesas />}

        {activeTab === 'livro' && <LivroCaixa onOpenDespesas={() => setActiveTab('despesas')} />}

        {activeTab !== 'painel' && activeTab !== 'comissoes' && activeTab !== 'despesas' && activeTab !== 'livro' && (
          <div className="flex items-center justify-center h-48 text-tinta-4 text-sm">
            Em desenvolvimento...
          </div>
        )}
      </div>
    </div>
  )
}
