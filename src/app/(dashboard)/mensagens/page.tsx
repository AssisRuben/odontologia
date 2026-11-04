'use client'

import { useState } from 'react'
import TabAutomaticas from '@/components/mensagens/TabAutomaticas'
import TabHistorico from '@/components/mensagens/TabHistorico'

type Tab = 'automaticas' | 'historico'

const tabs: { id: Tab; label: string }[] = [
  { id: 'automaticas', label: 'Automáticas' },
  { id: 'historico', label: 'Histórico' },
]

export default function MensagensPage() {
  const [activeTab, setActiveTab] = useState<Tab>('automaticas')

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col">
      <div className="bg-white border-b border-[#E5E7EB] px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#111827]">Central de Mensagens</h1>
      </div>

      <div className="bg-white border-b border-[#E5E7EB] px-6">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id ? 'border-[#3B82F6] text-[#3B82F6]' : 'border-transparent text-[#6B7280] hover:text-[#111827]'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'automaticas' && <TabAutomaticas />}
        {activeTab === 'historico' && <TabHistorico />}
      </div>
    </div>
  )
}
