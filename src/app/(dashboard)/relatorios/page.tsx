'use client'

import { useState } from 'react'
import { BarChart3, CheckCircle, XCircle, Users, TrendingUp, Clock } from 'lucide-react'

const sidebarItems = [
  { id: 'geral', label: 'Visão geral' },
  { id: 'orcamentos', label: 'Análise de Orçamentos', parent: 'Prontuário' },
  { id: 'tratamentos', label: 'Análise de Tratamentos', parent: 'Prontuário' },
  { id: 'consultas', label: 'Análise de Consultas', parent: 'Agenda' },
  { id: 'sem-consultas', label: 'Pacientes sem Consultas', parent: 'Agenda' },
  { id: 'cadastros', label: 'Análise de Cadastros', parent: 'Pacientes' },
  { id: 'assinaturas', label: 'Assinaturas digitais' },
]

const kpiCards = [
  { label: 'Comparecimento', value: '87%', icon: CheckCircle, color: '#10B981', meta: 'Meta: >85%', ok: true },
  { label: 'Agendadas', value: '142', icon: BarChart3, color: '#3B82F6' },
  { label: 'Canceladas', value: '18', icon: XCircle, color: '#EF4444' },
  { label: 'Novos pacientes', value: '23', icon: Users, color: '#8B5CF6' },
  { label: 'Maior atendimento', value: 'Dr. Carlos', icon: TrendingUp, color: '#F59E0B' },
  { label: 'Tempo médio espera', value: '12 min', icon: Clock, color: '#06B6D4' },
]

export default function RelatoriosPage() {
  const [activeItem, setActiveItem] = useState('geral')
  const currentSection = sidebarItems.find((i) => i.id === activeItem)

  return (
    <div className="flex h-[calc(100vh-56px)]">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-[#E5E7EB] overflow-y-auto p-3">
        <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide px-2 mb-2">Relatórios</p>
        {['', 'Prontuário', 'Agenda', 'Pacientes'].map((section) => {
          const items = sidebarItems.filter((i) => (i.parent || '') === section)
          if (!items.length) return null
          return (
            <div key={section} className="mb-3">
              {section && <p className="text-xs font-medium text-[#9CA3AF] px-2 mb-1">{section}</p>}
              {items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveItem(item.id)}
                  className={`w-full text-left px-2 py-1.5 rounded-lg text-sm transition-colors ${
                    activeItem === item.id
                      ? 'bg-[#EFF6FF] text-[#3B82F6] font-medium'
                      : 'text-[#374151] hover:bg-[#F3F4F6]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )
        })}
      </aside>

      {/* Conteúdo */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-[#111827]">
            {currentSection?.label || 'Relatórios'}
          </h1>
          <select className="h-9 px-3 rounded-lg border border-[#E5E7EB] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#3B82F6]">
            <option>Todo período</option>
            <option>Este mês</option>
            <option>Último mês</option>
            <option>Últimos 3 meses</option>
          </select>
        </div>

        {activeItem === 'geral' && (
          <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-3 gap-4">
              {kpiCards.map((kpi) => (
                <div key={kpi.label} className="bg-white rounded-xl border border-[#E5E7EB] p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-[#6B7280]">{kpi.label}</span>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: kpi.color + '20' }}>
                      <kpi.icon className="w-4 h-4" style={{ color: kpi.color }} />
                    </div>
                  </div>
                  <div className="text-2xl font-bold text-[#111827]">{kpi.value}</div>
                  {kpi.meta && (
                    <div className={`text-xs mt-1 ${kpi.ok ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                      {kpi.meta}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Gráfico placeholder */}
            <div className="bg-white rounded-xl border border-[#E5E7EB] p-6">
              <h2 className="text-base font-semibold text-[#111827] mb-4">Gráfico de Comparecimento</h2>
              <div className="h-48 flex items-end gap-3 px-4">
                {['Jan', 'Fev', 'Mar', 'Abr', 'Mai'].map((month, i) => {
                  const heights = [72, 85, 68, 90, 87]
                  const h = heights[i]
                  return (
                    <div key={month} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-xs text-[#6B7280]">{h}%</span>
                      <div
                        className="w-full rounded-t-md"
                        style={{ height: `${h * 1.5}px`, backgroundColor: h >= 85 ? '#10B981' : '#3B82F6' }}
                      />
                      <span className="text-xs text-[#9CA3AF]">{month}</span>
                    </div>
                  )
                })}
              </div>
              <div className="flex items-center gap-4 mt-4 text-xs text-[#6B7280]">
                <div className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#10B981]" /> Acima da meta</div>
                <div className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#3B82F6]" /> Abaixo da meta</div>
              </div>
            </div>
          </div>
        )}

        {activeItem !== 'geral' && (
          <div className="flex items-center justify-center h-48 text-[#9CA3AF] text-sm">
            Em desenvolvimento...
          </div>
        )}
      </div>
    </div>
  )
}
