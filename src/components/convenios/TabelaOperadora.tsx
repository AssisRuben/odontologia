'use client'

import { useEffect, useState } from 'react'
import { Search, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { validarItemTabela } from '@/lib/convenios/cadastro'
import { formatCurrency } from '@/lib/utils'
import type { InsurancePlan, InsurancePlanProcedure, TussProcedure } from '@/types'

interface Props {
  plan: InsurancePlan
}

const INPUT = 'h-9 px-2.5 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] bg-white'

/** "1.234,56" ou "1234.56" -> número; texto inválido -> NaN (rejeitado por validarItemTabela). */
function parseValor(s: string): number {
  const t = s.replace(/R\$/g, '').replace(/\s/g, '')
  if (t === '') return NaN
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  return /^\d+(\.\d+)?$/.test(normal) ? Number(normal) : NaN
}

function valorParaTexto(v: number): string {
  return v.toFixed(2).replace('.', ',')
}

function mensagemErro(err: { code?: string; message: string }): string {
  return err.code === '23505' ? 'Esse código já está na tabela' : `Erro: ${err.message}`
}

export function TabelaOperadora({ plan }: Props) {
  const [items, setItems] = useState<InsurancePlanProcedure[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TussProcedure[]>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState<TussProcedure | null>(null)
  const [manual, setManual] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const [manualName, setManualName] = useState('')
  const [newValue, setNewValue] = useState('')
  const [newAuth, setNewAuth] = useState(false)
  const [adding, setAdding] = useState(false)

  const [editing, setEditing] = useState<Record<string, string>>({})

  const [reloadKey, setReloadKey] = useState(0)
  const load = () => setReloadKey(k => k + 1)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    supabase
      .from('insurance_plan_procedures')
      .select('*')
      .eq('insurance_plan_id', plan.id)
      .eq('clinic_id', plan.clinic_id)
      .order('code')
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) setError(`Erro: ${err.message}`)
        else setItems((data ?? []) as InsurancePlanProcedure[])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [plan.id, plan.clinic_id, reloadKey])

  // Busca TUSS com debounce
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2 || picked) return
    let cancelled = false
    const timer = setTimeout(async () => {
      setSearching(true)
      const supabase = createClient()
      let req = supabase.from('tuss_procedures').select('code, name')
      if (/^\d+$/.test(q)) {
        req = req.ilike('code', `${q}%`)
      } else {
        const safe = q.replace(/[%_,()\\]/g, ' ')
        req = req.ilike('name', `%${safe}%`)
      }
      const { data, error: err } = await req.order('code').limit(20)
      if (!cancelled) {
        if (err) { setError(`Erro na busca: ${err.message}`); setResults([]) }
        else setResults((data ?? []) as TussProcedure[])
        setSearching(false)
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query, picked])

  const existing = new Set(items.map(i => i.code))
  const visibleResults = query.trim().length >= 2 && !picked ? results.filter(r => !existing.has(r.code)) : []

  function resetAdd() {
    setQuery(''); setPicked(null); setManual(false)
    setManualCode(''); setManualName(''); setNewValue(''); setNewAuth(false)
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const v = validarItemTabela({
      code: manual ? manualCode : picked?.code,
      name: manual ? manualName : picked?.name,
      value: parseValor(newValue),
      requires_authorization: newAuth,
    })
    if (!v.ok) { setError(v.error); return }
    setError('')
    setAdding(true)
    const supabase = createClient()
    const { error: err } = await supabase.from('insurance_plan_procedures').insert({
      clinic_id: plan.clinic_id,
      insurance_plan_id: plan.id,
      ...v.dados,
    })
    setAdding(false)
    if (err) { setError(mensagemErro(err)); return }
    resetAdd()
    load()
  }

  async function update(item: InsurancePlanProcedure, patch: Partial<Pick<InsurancePlanProcedure, 'value' | 'requires_authorization' | 'active'>>) {
    setError('')
    const supabase = createClient()
    const { data, error: err } = await supabase
      .from('insurance_plan_procedures')
      .update(patch)
      .eq('id', item.id)
      .eq('clinic_id', plan.clinic_id)
      .select('id')
    if (err) { setError(mensagemErro(err)); return }
    if (!data || data.length === 0) { setError('Não foi possível salvar a alteração'); return }
    setItems(prev => prev.map(i => (i.id === item.id ? { ...i, ...patch } : i)))
  }

  function commitValue(item: InsurancePlanProcedure) {
    const raw = editing[item.id]
    if (raw === undefined) return
    setEditing(prev => { const n = { ...prev }; delete n[item.id]; return n })
    const v = validarItemTabela({ code: item.code, name: item.name, value: parseValor(raw), requires_authorization: item.requires_authorization })
    if (!v.ok) { setError(v.error); return }
    if (v.dados.value === item.value) return
    update(item, { value: v.dados.value })
  }

  const adicionando = picked !== null || manual

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide">Tabela de procedimentos</p>

      {!adicionando && (
        <div className="space-y-2">
          <div className="relative">
            <Search className="w-4 h-4 text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Buscar procedimento TUSS por nome ou código"
              className={`${INPUT} w-full pl-9 h-10`} />
          </div>
          {query.trim().length >= 2 && (
            <div className="bg-white rounded-lg border border-[#E5E7EB] divide-y divide-[#F3F4F6] max-h-60 overflow-y-auto">
              {searching ? (
                <p className="px-3 py-3 text-sm text-[#6B7280]">Buscando...</p>
              ) : visibleResults.length === 0 ? (
                <p className="px-3 py-3 text-sm text-[#6B7280]">Nenhum procedimento encontrado.</p>
              ) : visibleResults.map(r => (
                <button key={r.code} type="button" onClick={() => setPicked(r)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[#F3F4F6]">
                  <span className="font-mono text-[#6B7280] mr-2">{r.code}</span>
                  <span className="text-[#111827]">{r.name}</span>
                </button>
              ))}
            </div>
          )}
          <button type="button" onClick={() => { setManual(true); setQuery('') }}
            className="text-sm text-[#3B82F6] hover:underline">
            Código fora da lista
          </button>
        </div>
      )}

      {adicionando && (
        <form onSubmit={handleAdd} className="bg-white rounded-lg border border-[#E5E7EB] p-3 space-y-3">
          {manual ? (
            <div className="grid grid-cols-3 gap-2">
              <input value={manualCode} onChange={e => setManualCode(e.target.value)} placeholder="Código" className={INPUT} />
              <input value={manualName} onChange={e => setManualName(e.target.value)} placeholder="Nome do procedimento" className={`${INPUT} col-span-2`} />
            </div>
          ) : (
            <p className="text-sm text-[#111827]">
              <span className="font-mono text-[#6B7280] mr-2">{picked!.code}</span>{picked!.name}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <input value={newValue} onChange={e => setNewValue(e.target.value)} placeholder="Valor (R$)" inputMode="decimal"
              className={`${INPUT} w-32`} />
            <label className="flex items-center gap-2 cursor-pointer text-sm text-[#111827]">
              <input type="checkbox" checked={newAuth} onChange={e => setNewAuth(e.target.checked)}
                className="w-4 h-4 rounded border-[#D1D5DB]" />
              Exige autorização
            </label>
            <div className="flex gap-2 ml-auto">
              <button type="button" onClick={resetAdd}
                className="px-3 h-9 rounded-lg border border-[#E5E7EB] text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6]">
                Cancelar
              </button>
              <button type="submit" disabled={adding}
                className="flex items-center gap-1.5 px-3 h-9 bg-[#3B82F6] text-white text-sm font-medium rounded-lg hover:bg-[#2563EB] disabled:opacity-50">
                <Plus className="w-4 h-4" /> Adicionar
              </button>
            </div>
          </div>
        </form>
      )}

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      {loading ? (
        <p className="text-sm text-[#6B7280]">Carregando...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-[#6B7280] py-3">Nenhum procedimento na tabela.</p>
      ) : (
        <div className="bg-white rounded-lg border border-[#E5E7EB] divide-y divide-[#F3F4F6]">
          {items.map(item => (
            <div key={item.id} className={`flex flex-wrap items-center gap-3 px-3 py-2 ${item.active ? '' : 'opacity-60'}`}>
              <span className="font-mono text-xs text-[#6B7280] w-24 shrink-0">{item.code}</span>
              <span className="flex-1 min-w-40 text-sm text-[#111827]">{item.name}</span>
              <input
                value={editing[item.id] ?? valorParaTexto(item.value)}
                onChange={e => setEditing(prev => ({ ...prev, [item.id]: e.target.value }))}
                onBlur={() => commitValue(item)}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                inputMode="decimal"
                aria-label={`Valor de ${item.code} (${formatCurrency(item.value)})`}
                className={`${INPUT} w-28 text-right`} />
              <label className="flex items-center gap-1.5 cursor-pointer text-xs text-[#6B7280]">
                <input type="checkbox" checked={item.requires_authorization}
                  onChange={e => update(item, { requires_authorization: e.target.checked })}
                  className="w-4 h-4 rounded border-[#D1D5DB]" />
                Exige autorização
              </label>
              <button type="button" onClick={() => update(item, { active: !item.active })}
                className="text-xs font-medium text-[#6B7280] hover:text-[#111827] px-2 py-1 rounded-lg hover:bg-[#F3F4F6]">
                {item.active ? 'Desativar' : 'Reativar'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
