'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { validarOperadora } from '@/lib/convenios/cadastro'
import type { InsurancePlan } from '@/types'
import { TabelaOperadora } from './TabelaOperadora'

interface Props {
  plan: InsurancePlan
  onSaved: (updated: InsurancePlan) => void
}

const INPUT = 'w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]'
const LABEL = 'block text-sm font-medium text-[#111827] mb-1'

export function PainelOperadora({ plan, onSaved }: Props) {
  const [ans, setAns] = useState(plan.ans_registry ?? '')
  const [provider, setProvider] = useState(plan.provider_code ?? '')
  const [closing, setClosing] = useState(plan.closing_day == null ? '' : String(plan.closing_day))
  const [days, setDays] = useState(String(plan.submission_days))
  const [active, setActive] = useState(plan.active)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaved(false)
    const v = validarOperadora({
      ans_registry: ans,
      provider_code: provider,
      closing_day: closing,
      submission_days: days,
      active,
    })
    if (!v.ok) { setError(v.error); return }
    setError('')
    setSaving(true)
    const supabase = createClient()
    const { data, error: err } = await supabase
      .from('insurance_plans')
      .update(v.dados)
      .eq('id', plan.id)
      .eq('clinic_id', plan.clinic_id)
      .select('*')
      .single()
    setSaving(false)
    if (err || !data) { setError(`Erro: ${err?.message ?? 'não foi possível salvar'}`); return }
    setSaved(true)
    onSaved(data as InsurancePlan)
  }

  return (
    <div className="px-5 py-4 bg-[#F9FAFB] space-y-5">
      <form onSubmit={handleSave} className="space-y-3">
        <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide">Dados da operadora</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>Registro ANS</label>
            <input value={ans} onChange={e => { setAns(e.target.value); setSaved(false) }} placeholder="6 dígitos" inputMode="numeric" className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Código do prestador</label>
            <input value={provider} onChange={e => { setProvider(e.target.value); setSaved(false) }} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Dia de fechamento</label>
            <input value={closing} onChange={e => { setClosing(e.target.value); setSaved(false) }} placeholder="1 a 28" inputMode="numeric" className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Prazo de envio (dias)</label>
            <input value={days} onChange={e => { setDays(e.target.value); setSaved(false) }} inputMode="numeric" className={INPUT} />
          </div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={active} onChange={e => { setActive(e.target.checked); setSaved(false) }}
            className="w-4 h-4 rounded border-[#D1D5DB]" />
          <span className="text-sm font-medium text-[#111827]">Operadora ativa</span>
        </label>
        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving}
            className="px-4 h-10 bg-[#3B82F6] text-white text-sm font-medium rounded-lg hover:bg-[#2563EB] transition-colors disabled:opacity-50">
            {saving ? 'Salvando...' : 'Salvar operadora'}
          </button>
          {saved && <span className="text-sm text-green-600">Salvo</span>}
        </div>
      </form>

      <TabelaOperadora plan={plan} />
    </div>
  )
}
