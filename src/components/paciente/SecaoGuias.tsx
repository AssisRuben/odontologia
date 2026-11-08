'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { formatCurrency } from '@/lib/utils'
import { divergencias } from '@/lib/convenios/divergencia'
import { ModalCriarGuia } from '@/components/convenios/ModalCriarGuia'
import { ModalRespostaGuia } from '@/components/convenios/ModalRespostaGuia'
import type {
  GuideStatus, InsuranceGuide, InsuranceGuideItem, InsurancePlan, InsurancePlanProcedure,
  Professional, Treatment,
} from '@/types'

const GUIDE_STATUS: Record<GuideStatus, { label: string; color: string; bg: string }> = {
  aguardando: { label: 'Aguardando', color: '#F97316', bg: '#FFF7ED' },
  liberada:   { label: 'Liberada',   color: '#22C55E', bg: '#F0FDF4' },
  cancelada:  { label: 'Cancelada',  color: '#EF4444', bg: '#FEF2F2' },
}

const AUTH_LABEL: Record<string, string> = {
  pendente: 'Pendente', autorizado: 'Autorizado', negado: 'Negado', nao_exige: 'Não exige autorização',
}

function fmtDate(d: string | null) {
  return d ? format(parseISO(d), 'dd/MM/yyyy') : '—'
}

interface Props {
  patientId: string
  patientPlanId: string | null
  insuranceCard: string | null
  insuranceCardValidUntil: string | null
  guides: InsuranceGuide[]
  treatments: Treatment[]
  procById: Map<string, InsurancePlanProcedure>
  plans: InsurancePlan[]
  professionals: Professional[]
  onChanged: () => void
}

export function SecaoGuias({
  patientId, patientPlanId, insuranceCard, insuranceCardValidUntil, guides, treatments, procById,
  plans, professionals, onChanged,
}: Props) {
  const [criando, setCriando] = useState(false)
  const [respondendo, setRespondendo] = useState<InsuranceGuide | null>(null)
  const [cancelando, setCancelando] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const treatById = new Map(treatments.map((t) => [t.id, t]))
  const treatmentIdsEmGuia = new Set<string>()
  for (const g of guides) {
    for (const i of g.items || []) if (i.active && i.treatment_id) treatmentIdsEmGuia.add(i.treatment_id)
  }

  async function call(key: string, url: string, init: RequestInit) {
    setError('')
    setBusy(key)
    try {
      const res = await fetch(url, init)
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error || 'Erro ao salvar')
        return false
      }
      window.dispatchEvent(new Event('convenios:changed'))
      onChanged()
      return true
    } catch {
      setError('Erro ao salvar')
      return false
    } finally {
      setBusy(null)
    }
  }

  async function cancelar(id: string) {
    const ok = await call(`c-${id}`, `/api/guias/${id}/cancelar`, { method: 'POST' })
    if (ok) setCancelando(null)
  }

  function atualizarItem(id: string) {
    return call(`a-${id}`, `/api/guias/itens/${id}/atualizar`, { method: 'POST' })
  }

  function salvarExecucao(id: string, executedAt: string) {
    return call(`e-${id}`, `/api/guias/itens/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ executedAt }),
    })
  }

  function divergenciaDoItem(item: InsuranceGuideItem): boolean {
    if (!item.active || !item.treatment_id) return false
    const t = treatById.get(item.treatment_id)
    if (!t) return false
    const proc = t.insurance_procedure_id ? procById.get(t.insurance_procedure_id) : undefined
    return divergencias(
      { code: item.code, value: item.value ?? 0, teeth: item.teeth },
      {
        code: proc?.code ?? null,
        value: t.value,
        teeth: (t.treatment_teeth || []).map((tt) => ({ tooth: tt.tooth_number, faces: tt.faces })),
      },
    ).length > 0
  }

  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden mt-4">
      <div className="px-5 py-4 border-b border-[#E5E7EB] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#111827]">Guias</h3>
        <button
          onClick={() => setCriando(true)}
          disabled={plans.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3B82F6] text-white text-xs font-medium hover:bg-[#2563EB] transition-colors disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" />
          Criar guia
        </button>
      </div>

      {error && <div className="mx-5 mt-4 p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>}

      {guides.length === 0 ? (
        <div className="flex items-center justify-center h-24">
          <p className="text-sm text-[#9CA3AF]">Nenhuma guia registrada.</p>
        </div>
      ) : (
        <div className="divide-y divide-[#F3F4F6]">
          {guides.map((g) => {
            const s = GUIDE_STATUS[g.status]
            const plan = plans.find((p) => p.id === g.insurance_plan_id)
            const items = (g.items || []).slice().sort((a, b) => a.created_at.localeCompare(b.created_at))
            const emLote = items.some((i) => i.active && i.batch_id)
            return (
              <div key={g.id} className="px-5 py-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-[#111827]">{plan?.name || 'Convênio'}</span>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: s.bg, color: s.color }}>
                        {s.label}
                      </span>
                    </div>
                    <p className="text-xs text-[#6B7280] mt-0.5">
                      Criada em {format(parseISO(g.created_at), 'dd/MM/yyyy')}
                      {` · Nº ${g.guide_number || '—'}`}
                      {` · Senha ${g.password || '—'}`}
                      {` · Validade ${fmtDate(g.password_valid_until)}`}
                    </p>
                  </div>
                  {g.status !== 'cancelada' && (
                    <div className="flex items-center gap-3">
                      <button onClick={() => setRespondendo(g)} className="text-xs text-[#3B82F6] hover:underline">
                        Registrar resposta
                      </button>
                      {cancelando === g.id ? (
                        <span className="flex items-center gap-2 text-xs">
                          <span className="text-[#6B7280]">Cancelar esta guia?</span>
                          <button
                            onClick={() => cancelar(g.id)} disabled={busy === `c-${g.id}`}
                            className="text-[#EF4444] font-medium hover:underline disabled:opacity-50"
                          >
                            Confirmar
                          </button>
                          <button onClick={() => setCancelando(null)} className="text-[#6B7280] hover:underline">
                            Voltar
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setCancelando(g.id)}
                          disabled={emLote}
                          title={emLote ? 'Guia com item em lote não pode ser alterada' : undefined}
                          className="text-xs text-[#EF4444] hover:underline disabled:opacity-40 disabled:no-underline"
                        >
                          Cancelar guia
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  {items.map((i) => {
                    const diverge = divergenciaDoItem(i)
                    return (
                      <div key={i.id} className={`rounded-lg border border-[#E5E7EB] px-3 py-2 ${i.active ? '' : 'opacity-60'}`}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-[#111827]">{i.code} · {i.name}</span>
                          <span className="text-xs text-[#6B7280]">{AUTH_LABEL[i.authorization]}</span>
                          {i.batch_id && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#EFF6FF] text-[#3B82F6]">Em lote</span>
                          )}
                          {diverge && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#FEF3C7] text-[#92400E]">
                              Diferente do tratamento
                            </span>
                          )}
                          {diverge && !i.batch_id && g.status !== 'cancelada' && (
                            <button
                              onClick={() => atualizarItem(i.id)} disabled={busy === `a-${i.id}`}
                              className="text-xs text-[#3B82F6] hover:underline disabled:opacity-50"
                            >
                              Atualizar item
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-[#6B7280] mt-0.5">
                          {i.value !== null && formatCurrency(i.value)}
                          {i.teeth.length > 0 && ` · Dentes: ${i.teeth.map((t) => t.faces.length ? `${t.tooth} (${t.faces.join('')})` : t.tooth).join(', ')}`}
                          {i.denial_reason && ` · Motivo: ${i.denial_reason}`}
                        </p>
                        {i.active && g.status !== 'cancelada' && !i.batch_id && (
                          <ExecucaoItem
                            stored={i.executed_at ? i.executed_at.slice(0, 10) : ''}
                            busy={busy === `e-${i.id}`}
                            onSave={(d) => salvarExecucao(i.id, d)}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {criando && (
        <ModalCriarGuia
          patientId={patientId}
          patientPlanId={patientPlanId}
          insuranceCard={insuranceCard}
          insuranceCardValidUntil={insuranceCardValidUntil}
          plans={plans}
          professionals={professionals}
          treatments={treatments}
          treatmentIdsEmGuia={treatmentIdsEmGuia}
          onClose={() => setCriando(false)}
          onCreated={() => { setCriando(false); onChanged() }}
        />
      )}

      {respondendo && (
        <ModalRespostaGuia
          guide={respondendo}
          onClose={() => setRespondendo(null)}
          onSaved={() => { setRespondendo(null); onChanged() }}
        />
      )}
    </div>
  )
}

function ExecucaoItem({ stored, busy, onSave }: {
  stored: string
  busy: boolean
  onSave: (d: string) => Promise<boolean> | undefined
}) {
  const [value, setValue] = useState(stored)
  const [msg, setMsg] = useState('')
  const changed = value !== stored

  async function save() {
    const year = Number(value.slice(0, 4))
    if (!value || !(year >= 2000 && year <= 2100)) {
      setMsg('Data inválida')
      return
    }
    setMsg('')
    await onSave(value)
  }

  return (
    <div className="flex items-center gap-2 mt-1.5 text-xs text-[#6B7280] flex-wrap">
      <label className="flex items-center gap-2">
        Executado em
        <input
          type="date" value={value}
          onChange={(e) => { setValue(e.target.value); setMsg('') }}
          className="h-8 px-2 rounded border border-[#E5E7EB] text-xs"
        />
      </label>
      {changed && (
        <button
          type="button" onClick={save} disabled={busy}
          className="text-[#3B82F6] hover:underline disabled:opacity-50"
        >
          Salvar
        </button>
      )}
      {msg && <span className="text-[#EF4444]">{msg}</span>}
    </div>
  )
}
