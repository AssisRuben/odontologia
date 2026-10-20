'use client'

import { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown, DollarSign, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react'
import { format, startOfMonth, endOfMonth, addMonths, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import { formatCurrency } from '@/lib/utils'
import type { Payment, Expense } from '@/types'

type Tab = 'painel' | 'fluxo' | 'boletos' | 'comissoes'

export default function FinanceiroPage() {
  const { clinicId, loading: clinicLoading } = useClinicStore()
  const [activeTab, setActiveTab] = useState<Tab>('painel')
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [payments, setPayments] = useState<Payment[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clinicId) return
    async function load() {
      setLoading(true)
      const supabase = createClient()
      const start = format(startOfMonth(currentMonth), 'yyyy-MM-dd')
      const end = format(endOfMonth(currentMonth), 'yyyy-MM-dd')

      const [paymentsRes, expensesRes] = await Promise.all([
        supabase.from('payments').select('*, patient:patients(name)').eq('clinic_id', clinicId!)
          .gte('due_date', start).lte('due_date', end),
        supabase.from('expenses').select('*').eq('clinic_id', clinicId!)
          .gte('due_date', start).lte('due_date', end),
      ])
      setPayments(paymentsRes.data || [])
      setExpenses(expensesRes.data || [])
      setLoading(false)
    }
    load()
  }, [clinicId, currentMonth])

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
  ]

  if (clinicLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)]">
        <div className="w-8 h-8 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col">
      <div className="bg-white border-b border-[#E5E7EB] px-4 sm:px-6 py-3 sm:py-4">
        <h1 className="text-lg sm:text-xl font-semibold text-[#111827]">Financeiro</h1>
      </div>

      <div className="bg-white border-b border-[#E5E7EB] px-2 sm:px-6 overflow-x-auto">
        <div className="flex min-w-max">
          {tabs.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id ? 'border-[#3B82F6] text-[#3B82F6]' : 'border-transparent text-[#6B7280] hover:text-[#111827]'
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
                className="p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280]">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-base font-semibold text-[#111827] capitalize w-44 text-center">
                {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}
              </span>
              <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                className="p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280]">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                {/* Cards de visão geral */}
                <div>
                  <h2 className="text-sm font-semibold text-[#6B7280] uppercase tracking-wide mb-3">Visão Geral</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                          <TrendingUp className="w-4 h-4 text-[#10B981]" />
                        </div>
                        <span className="font-semibold text-[#111827]">Entradas</span>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-[#6B7280]">Recebido</span>
                          <span className="font-semibold text-[#10B981]">{formatCurrency(recebido)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-[#6B7280]">A receber</span>
                          <span className="font-medium text-[#374151]">{formatCurrency(aReceber)}</span>
                        </div>
                        <div className="border-t border-[#E5E7EB] pt-2 flex justify-between text-sm">
                          <span className="text-[#6B7280]">Total previsto</span>
                          <span className="font-bold text-[#111827]">{formatCurrency(totalEntradas)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
                          <TrendingDown className="w-4 h-4 text-[#EF4444]" />
                        </div>
                        <span className="font-semibold text-[#111827]">Saídas</span>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-[#6B7280]">Pago</span>
                          <span className="font-semibold text-[#EF4444]">{formatCurrency(pago)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-[#6B7280]">A pagar</span>
                          <span className="font-medium text-[#374151]">{formatCurrency(aPagar)}</span>
                        </div>
                        <div className="border-t border-[#E5E7EB] pt-2 flex justify-between text-sm">
                          <span className="text-[#6B7280]">Total previsto</span>
                          <span className="font-bold text-[#111827]">{formatCurrency(totalSaidas)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                          <DollarSign className="w-4 h-4 text-[#3B82F6]" />
                        </div>
                        <span className="font-semibold text-[#111827]">Resultado</span>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <p className="text-xs text-[#6B7280] mb-1">Líquido realizado</p>
                          <p className={`text-2xl font-bold ${resultado >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                            {formatCurrency(resultado)}
                          </p>
                        </div>
                        <div className="flex justify-between text-sm border-t border-[#E5E7EB] pt-2">
                          <span className="text-[#6B7280]">Previsão</span>
                          <span className="font-medium text-[#374151]">{formatCurrency(totalEntradas - totalSaidas)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Inadimplência */}
                {inadimplentes.length > 0 && (
                  <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertCircle className="w-5 h-5 text-[#EF4444]" />
                      <h3 className="font-semibold text-[#111827]">Total de inadimplência</h3>
                    </div>
                    <div className="flex items-center gap-6">
                      <div>
                        <p className="text-2xl font-bold text-[#EF4444]">
                          {formatCurrency(inadimplentes.reduce((s, p) => s + p.amount, 0))}
                        </p>
                        <p className="text-sm text-[#6B7280] mt-0.5">{inadimplentes.length} pagamento(s) em atraso</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Próximas despesas */}
                {expenses.filter((e) => e.status === 'pending').length > 0 && (
                  <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
                    <h3 className="font-semibold text-[#111827] mb-3">Próximas despesas</h3>
                    <div className="space-y-2">
                      {expenses.filter((e) => e.status === 'pending').map((exp) => (
                        <div key={exp.id} className="flex items-center justify-between py-2 border-b border-[#F3F4F6] last:border-0">
                          <div>
                            <p className="text-sm font-medium text-[#111827]">{exp.description}</p>
                            <p className="text-xs text-[#9CA3AF]">{exp.category} · Vence {exp.due_date ? format(new Date(exp.due_date), 'dd/MM/yyyy') : '—'}</p>
                          </div>
                          <span className="text-sm font-semibold text-[#EF4444]">{formatCurrency(exp.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {payments.length === 0 && expenses.length === 0 && (
                  <div className="flex items-center justify-center py-16 text-[#9CA3AF] text-sm">
                    Nenhum lançamento neste mês.
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab !== 'painel' && (
          <div className="flex items-center justify-center h-48 text-[#9CA3AF] text-sm">
            Em desenvolvimento...
          </div>
        )}
      </div>
    </div>
  )
}
