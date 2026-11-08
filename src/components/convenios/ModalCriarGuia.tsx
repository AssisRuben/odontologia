'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { situacaoCarteirinha } from '@/lib/convenios/cadastro'
import { naTabela } from '@/lib/convenios/guias'
import { todayYmd } from '@/lib/messaging/time'
import type { InsurancePlan, InsurancePlanProcedure, Professional, Treatment } from '@/types'

interface Props {
  patientPlanId: string | null
  insuranceCard: string | null
  insuranceCardValidUntil: string | null
  patientId: string
  plans: InsurancePlan[]
  professionals: Professional[]
  treatments: Treatment[]
  /** procedimentos da tabela vinculados aos tratamentos, por id */
  procById: Map<string, InsurancePlanProcedure>
  /** ids de tratamentos que já têm item ativo em alguma guia */
  treatmentIdsEmGuia: Set<string>
  onClose: () => void
  onCreated: () => void
}

export function ModalCriarGuia({
  patientPlanId, insuranceCard, insuranceCardValidUntil, patientId, plans, professionals,
  treatments, procById, treatmentIdsEmGuia, onClose, onCreated,
}: Props) {
  const [planId, setPlanId] = useState(patientPlanId || plans[0]?.id || '')
  const [professionalId, setProfessionalId] = useState(professionals[0]?.id || '')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const eligible = treatments.filter(
    (t) =>
      t.insurance_plan_id === planId &&
      t.status !== 'cancelled' &&
      !!t.insurance_procedure_id &&
      naTabela(t.insurance_plan_id, procById.get(t.insurance_procedure_id)) &&
      !treatmentIdsEmGuia.has(t.id),
  )
  // Só vale a carteirinha do paciente quando a operadora escolhida é a dele.
  const carteira = planId === patientPlanId
    ? situacaoCarteirinha(insuranceCard, insuranceCardValidUntil, todayYmd(new Date(), 'America/Sao_Paulo'))
    : 'vazia'

  function changePlan(id: string) {
    setPlanId(id)
    setSelected(new Set())
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (selected.size === 0) { setError('Escolha ao menos um tratamento'); return }
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/guias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId,
          insurancePlanId: planId,
          professionalId: professionalId || null,
          treatmentIds: Array.from(selected),
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error || 'Erro ao criar guia')
        setLoading(false)
        return
      }
      window.dispatchEvent(new Event('convenios:changed'))
      onCreated()
    } catch {
      setError('Erro ao criar guia')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white z-10 flex items-center justify-between p-5 border-b border-[#E5E7EB]">
          <h2 className="text-base font-semibold text-[#111827]">Criar guia</h2>
          <button onClick={onClose} className="p-1 rounded text-[#6B7280] hover:text-[#111827]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-[#111827] mb-1">Operadora</label>
              <select
                value={planId} onChange={(e) => changePlan(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] bg-white"
              >
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#111827] mb-1">Executante</label>
              <select
                value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] bg-white"
              >
                <option value="">— selecione —</option>
                {professionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>

          {carteira === 'vazia' && (
            <div className="p-3 rounded-lg bg-[#FEF3C7] text-[#92400E] text-sm">Carteirinha vazia</div>
          )}
          {carteira === 'vencida' && (
            <div className="p-3 rounded-lg bg-[#FEF3C7] text-[#92400E] text-sm">Carteirinha vencida</div>
          )}

          <div>
            <p className="block text-sm font-medium text-[#111827] mb-2">Tratamentos</p>
            {eligible.length === 0 ? (
              <p className="text-sm text-[#9CA3AF]">Nenhum tratamento elegível para esta operadora.</p>
            ) : (
              <div className="space-y-1.5">
                {eligible.map((t) => (
                  <label
                    key={t.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg border border-[#E5E7EB] cursor-pointer hover:bg-[#F9FAFB]"
                  >
                    <input
                      type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)}
                      className="w-4 h-4 accent-[#3B82F6]"
                    />
                    <span className="flex-1 min-w-0 text-sm text-[#111827] truncate">{t.procedure}</span>
                    <span className="text-xs text-[#6B7280] shrink-0">{formatCurrency(t.value)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {error && <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>}

          <div className="flex gap-3 pt-2">
            <button
              type="button" onClick={onClose}
              className="flex-1 h-10 rounded-lg border border-[#E5E7EB] text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit" disabled={loading || eligible.length === 0}
              className="flex-1 h-10 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-[#2563EB] transition-colors disabled:opacity-50"
            >
              {loading ? 'Criando...' : 'Criar guia'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
