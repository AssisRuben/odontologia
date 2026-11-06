'use client'

import { useCallback, useEffect, useState } from 'react'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { TZDate } from '@date-fns/tz'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import type { Funnel } from '@/lib/orcamentos/funil'
import type { FunnelListRow } from '@/lib/orcamentos/repo'
import { Indicadores } from '@/components/orcamentos/Indicadores'
import { ListaOrcamentos, type TabKey } from '@/components/orcamentos/ListaOrcamentos'

interface FunilData {
  funnel: Funnel
  tabs: Record<TabKey, FunnelListRow[]>
  professionals: { id: string; name: string }[]
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'enviados', label: 'Enviados' },
  { key: 'paraLigar', label: 'Para ligar' },
  { key: 'aprovados', label: 'Aprovados' },
  { key: 'perdidos', label: 'Perdidos' },
]

function currentMonth(): { de: string; ate: string } {
  const now = new TZDate(Date.now(), 'America/Sao_Paulo')
  return { de: format(startOfMonth(now), 'yyyy-MM-dd'), ate: format(endOfMonth(now), 'yyyy-MM-dd') }
}

const inputCls = 'h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#3B82F6]'

export default function OrcamentosPage() {
  const { clinicId, loading: clinicLoading } = useClinicStore()
  const [period, setPeriod] = useState(currentMonth)
  const [dentista, setDentista] = useState('')
  const [tab, setTab] = useState<TabKey>('paraLigar')
  const [data, setData] = useState<FunilData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const reload = useCallback(() => setReloadKey(k => k + 1), [])

  useEffect(() => {
    if (!clinicId) return
    let stale = false
    async function load() {
      const qs = new URLSearchParams({ de: period.de, ate: period.ate })
      if (dentista) qs.set('dentista', dentista)
      try {
        const res = await fetch(`/api/orcamentos/funil?${qs}`)
        const json = await res.json().catch(() => ({}))
        if (stale) return
        if (!res.ok) { setError(json.error ?? 'Não foi possível carregar os orçamentos.'); return }
        setError('')
        setData(json)
      } catch {
        if (!stale) setError('Falha de conexão. Tente de novo.')
      } finally {
        if (!stale) setLoading(false)
      }
    }
    load()
    return () => { stale = true }
  }, [clinicId, period, dentista, reloadKey])

  // Abrir a aba Aprovados marca os aprovados novos como vistos (zera a bolinha do menu).
  useEffect(() => {
    if (tab !== 'aprovados' || !clinicId || !data) return
    // marca todos os aprovados não vistos da clínica (o selo do menu conta todos, não só os filtrados)
    createClient().from('budgets').update({ approval_seen_at: new Date().toISOString() })
      .eq('clinic_id', clinicId).eq('status', 'approved').is('approval_seen_at', null)
      .then(({ error: err }) => { if (!err) window.dispatchEvent(new Event('orcamentos:seen')) })
  }, [tab, clinicId, data])

  const periodOk = period.de && period.ate && period.de <= period.ate

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold text-[#111827]">Orçamentos</h1>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-[#6B7280]">De
          <input type="date" value={period.de} onChange={e => setPeriod(p => ({ ...p, de: e.target.value }))} className={inputCls + ' block mt-1'} />
        </label>
        <label className="text-xs text-[#6B7280]">Até
          <input type="date" value={period.ate} onChange={e => setPeriod(p => ({ ...p, ate: e.target.value }))} className={inputCls + ' block mt-1'} />
        </label>
        <label className="text-xs text-[#6B7280]">Dentista
          <select value={dentista} onChange={e => setDentista(e.target.value)} className={inputCls + ' block mt-1'}>
            <option value="">Todos</option>
            <option value="none">Sem dentista</option>
            {data?.professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>
      {!periodOk && <p className="text-sm text-[#EF4444]">A data inicial deve ser anterior à final.</p>}

      {error && <p className="text-sm text-[#EF4444]">{error}</p>}

      {(loading || clinicLoading) && !data ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : data && (
        <>
          <Indicadores funnel={data.funnel} />

          <div className="flex gap-1 border-b border-[#E5E7EB] overflow-x-auto">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px ${
                  tab === t.key ? 'border-[#3B82F6] text-[#3B82F6]' : 'border-transparent text-[#6B7280] hover:text-[#111827]'
                }`}>
                {t.label} ({data.tabs[t.key].length})
              </button>
            ))}
          </div>

          <ListaOrcamentos tab={tab} rows={data.tabs[tab]} onChanged={reload} />
        </>
      )}
    </div>
  )
}
