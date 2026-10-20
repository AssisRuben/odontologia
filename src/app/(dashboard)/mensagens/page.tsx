'use client'

import { useState } from 'react'
import { MessageSquare, Send, Plus } from 'lucide-react'

type Tab = 'mensagens' | 'campanhas' | 'historico'

const campaigns = [
  {
    id: 'aniversariantes',
    title: 'Aniversariantes',
    description: 'Envie felicitações automáticas no dia do aniversário dos seus pacientes.',
    active: true,
  },
  {
    id: 'retorno',
    title: 'Retorno semestral',
    description: 'Lembre seus pacientes de marcar o retorno após 6 meses.',
    active: false,
  },
  {
    id: 'inadimplentes',
    title: 'Inadimplentes',
    description: 'Notifique pacientes com pagamentos em atraso.',
    active: false,
  },
  {
    id: 'pesquisa',
    title: 'Pesquisa de satisfação',
    description: 'Envie uma pesquisa após cada consulta concluída.',
    active: false,
  },
  {
    id: 'alinhadores',
    title: 'Alinhadores Invisíveis',
    description: 'Campanha de divulgação do tratamento com alinhadores.',
    active: false,
  },
  {
    id: 'personalizada',
    title: 'Campanha personalizada',
    description: 'Crie uma campanha personalizada para o seu público.',
    active: false,
    custom: true,
  },
]

export default function MensagensPage() {
  const [activeTab, setActiveTab] = useState<Tab>('campanhas')

  const tabs = [
    { id: 'mensagens' as Tab, label: 'Mensagens' },
    { id: 'campanhas' as Tab, label: 'Campanhas automáticas' },
    { id: 'historico' as Tab, label: 'Histórico de envio' },
  ]

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col">
      <div className="bg-white border-b border-[#E5E7EB] px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#111827]">Central de Mensagens</h1>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg">
            <MessageSquare className="w-4 h-4 text-green-600" />
            <span className="text-green-700 font-medium">WhatsApp: 50 créditos</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg">
            <Send className="w-4 h-4 text-blue-600" />
            <span className="text-blue-700 font-medium">SMS: 30 créditos</span>
          </div>
        </div>
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
        {activeTab === 'campanhas' && (
          <div className="grid grid-cols-3 gap-4 max-w-5xl">
            {campaigns.map((campaign) => (
              <div key={campaign.id} className="bg-white rounded-xl border border-[#E5E7EB] p-5 flex flex-col">
                {/* Ilustração */}
                <div className="w-12 h-12 rounded-xl mb-4 flex items-center justify-center"
                  style={{ backgroundColor: campaign.active ? '#EFF6FF' : '#F3F4F6' }}>
                  {campaign.custom ? (
                    <Plus className="w-6 h-6 text-[#3B82F6]" />
                  ) : (
                    <MessageSquare className="w-6 h-6" style={{ color: campaign.active ? '#3B82F6' : '#9CA3AF' }} />
                  )}
                </div>
                <h3 className="font-semibold text-[#111827] mb-1">{campaign.title}</h3>
                <p className="text-sm text-[#6B7280] flex-1 mb-4">{campaign.description}</p>
                <button
                  className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
                    campaign.active
                      ? 'bg-[#10B981] text-white hover:bg-[#059669]'
                      : campaign.custom
                      ? 'border border-[#3B82F6] text-[#3B82F6] hover:bg-[#EFF6FF]'
                      : 'bg-[#3B82F6] text-white hover:bg-[#2563EB]'
                  }`}
                >
                  {campaign.active ? 'Ativo' : campaign.custom ? 'Criar campanha' : 'Ativar'}
                </button>
              </div>
            ))}
          </div>
        )}

        {activeTab !== 'campanhas' && (
          <div className="flex items-center justify-center h-48 text-[#9CA3AF] text-sm">
            Em desenvolvimento...
          </div>
        )}
      </div>
    </div>
  )
}
