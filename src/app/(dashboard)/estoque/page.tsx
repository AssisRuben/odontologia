'use client'

import { useState, useEffect } from 'react'
import { Plus, AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import type { InventoryItem } from '@/types'

type Tab = 'produtos' | 'historico'

export default function EstoquePage() {
  const { clinicId, loading: clinicLoading } = useClinicStore()
  const [activeTab, setActiveTab] = useState<Tab>('produtos')
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clinicId) return
    async function load() {
      const supabase = createClient()
      const { data } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('clinic_id', clinicId!)
        .order('name')
      setItems(data || [])
      setLoading(false)
    }
    load()
  }, [clinicId])

  const lowStock = items.filter((i) => i.quantity <= i.min_quantity)

  if (clinicLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)]">
        <div className="w-8 h-8 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col">
      <div className="bg-white border-b border-[#E5E7EB] px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
        <h1 className="text-lg sm:text-xl font-semibold text-[#111827]">Estoque</h1>
        <button className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-[#3B82F6] text-white rounded-lg text-sm font-medium hover:bg-[#2563EB] transition-colors shrink-0">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Gerenciar estoque</span>
          <span className="sm:hidden">Gerenciar</span>
        </button>
      </div>

      <div className="bg-white border-b border-[#E5E7EB] px-2 sm:px-6">
        <div className="flex">
          {(['produtos', 'historico'] as Tab[]).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab ? 'border-[#3B82F6] text-[#3B82F6]' : 'border-transparent text-[#6B7280] hover:text-[#111827]'
              }`}>
              {tab === 'historico' ? 'Histórico' : 'Produtos'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-6">
        {activeTab === 'produtos' && (
          <>
            {lowStock.length > 0 && (
              <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                <p className="text-sm text-amber-700">
                  <strong>{lowStock.length} item(s)</strong> com estoque abaixo do mínimo: {lowStock.map((i) => i.name).join(', ')}
                </p>
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center h-48">
                <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                  <rect x="12" y="20" width="40" height="30" rx="4" fill="#F3F4F6" />
                  <rect x="20" y="14" width="24" height="10" rx="2" fill="#E5E7EB" />
                  <line x1="24" y1="32" x2="40" y2="32" stroke="#D1D5DB" strokeWidth="2" strokeLinecap="round" />
                  <line x1="24" y1="38" x2="36" y2="38" stroke="#D1D5DB" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <p className="text-sm text-[#6B7280]">Nenhum produto cadastrado</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
                <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[480px]">
                  <thead>
                    <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB]">
                      <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Produto</th>
                      <th className="text-left px-4 py-3 font-medium text-[#6B7280]">Categoria</th>
                      <th className="text-center px-4 py-3 font-medium text-[#6B7280]">Qtd.</th>
                      <th className="text-center px-4 py-3 font-medium text-[#6B7280]">Mín.</th>
                      <th className="text-center px-4 py-3 font-medium text-[#6B7280]">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const isLow = item.quantity <= item.min_quantity
                      return (
                        <tr key={item.id} className="border-b border-[#E5E7EB] last:border-0 hover:bg-[#F9FAFB]">
                          <td className="px-4 py-3 font-medium text-[#111827]">{item.name}</td>
                          <td className="px-4 py-3 text-[#6B7280]">{item.category || '—'}</td>
                          <td className="px-4 py-3 text-center font-medium" style={{ color: isLow ? '#EF4444' : '#111827' }}>
                            {item.quantity} {item.unit || ''}
                          </td>
                          <td className="px-4 py-3 text-center text-[#6B7280]">{item.min_quantity}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${
                              isLow ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700'
                            }`}>
                              {isLow && <AlertTriangle className="w-3 h-3" />}
                              {isLow ? 'Baixo' : 'OK'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'historico' && (
          <div className="flex items-center justify-center h-48 text-[#9CA3AF] text-sm">
            Histórico de movimentação em desenvolvimento...
          </div>
        )}
      </div>
    </div>
  )
}
