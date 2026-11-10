'use client'

import { useState } from 'react'
import TabConversas from '@/components/mensagens/TabConversas'
import TabAutomaticas from '@/components/mensagens/TabAutomaticas'
import TabHistorico from '@/components/mensagens/TabHistorico'

type Tab = 'conversas' | 'automaticas' | 'historico'

const tabs: { id: Tab; label: string }[] = [
  { id: 'conversas', label: 'Conversas' },
  { id: 'automaticas', label: 'Automáticas' },
  { id: 'historico', label: 'Histórico' },
]

export default function MensagensPage() {
  const [activeTab, setActiveTab] = useState<Tab>('conversas')

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col">
      <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-3 flex items-center justify-between">
        <h1 className="text-2xl sm:text-[26px] font-semibold text-tinta leading-tight">Central de Mensagens</h1>
      </div>

      <div className="border-b border-linha px-6">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id ? 'border-petroleo text-petroleo' : 'border-transparent text-tinta-3 hover:text-tinta'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`flex-1 min-h-0 ${activeTab === 'conversas' ? 'p-3 sm:p-6' : 'overflow-y-auto p-6'}`}>
        {activeTab === 'conversas' && <TabConversas />}
        {activeTab === 'automaticas' && <TabAutomaticas />}
        {activeTab === 'historico' && <TabHistorico />}
      </div>
    </div>
  )
}
