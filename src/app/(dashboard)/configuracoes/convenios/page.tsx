'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ChevronLeft, Plus, Trash2, Shield, ChevronDown } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import type { InsurancePlan } from '@/types'
import { PainelOperadora } from '@/components/convenios/PainelOperadora'

export default function ConveniosPage() {
  const { clinicId } = useClinicStore()
  const [plans, setPlans] = useState<InsurancePlan[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  async function load() {
    if (!clinicId) return
    const supabase = createClient()
    const { data } = await supabase.from('insurance_plans').select('*').eq('clinic_id', clinicId).order('name')
    if (data) setPlans([...data].sort((a, b) => Number(b.active) - Number(a.active)))
    setLoading(false)
  }

  useEffect(() => { load() }, [clinicId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    const alreadyExists = plans.some(p => p.name.toLowerCase() === newName.trim().toLowerCase())
    if (alreadyExists) { setError('Já existe um convênio com esse nome.'); return }
    setError('')
    setAdding(true)
    const supabase = createClient()
    const { error: err } = await supabase.from('insurance_plans').insert({ clinic_id: clinicId, name: newName.trim() })
    setAdding(false)
    if (err) { setError(`Erro: ${err.message}`); return }
    setNewName('')
    load()
  }

  async function handleDelete(id: string, name: string) {
    const ok = window.confirm(
      `Excluir o convênio ${name}? A tabela de procedimentos dele será apagada e os tratamentos com este convênio passam a ser Particular.`,
    )
    if (!ok) return
    setDeletingId(id)
    setError('')
    const supabase = createClient()
    // Pacientes são desvinculados pelo banco (ON DELETE SET NULL); guias e lotes bloqueiam (RESTRICT).
    const { error: err } = await supabase.from('insurance_plans').delete().eq('id', id)
    setDeletingId(null)
    if (err) {
      setError(err.code === '23503' ? 'Convênio com guias não pode ser excluído. Desative-o.' : `Erro: ${err.message}`)
      return
    }
    if (openId === id) setOpenId(null)
    load()
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/configuracoes" className="p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280]">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-semibold text-[#111827]">Gestão de convênios</h1>
      </div>

      {/* Formulário de adição */}
      <form onSubmit={handleAdd} className="flex gap-2 mb-5">
        <input
          value={newName}
          onChange={e => { setNewName(e.target.value); setError('') }}
          placeholder="Nome do convênio (ex: Bradesco Saúde)"
          className="flex-1 h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
        />
        <button type="submit" disabled={adding || !newName.trim()}
          className="flex items-center gap-1.5 px-4 h-10 bg-[#3B82F6] text-white text-sm font-medium rounded-lg hover:bg-[#2563EB] transition-colors disabled:opacity-50">
          <Plus className="w-4 h-4" /> Adicionar
        </button>
      </form>
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#E5E7EB] divide-y divide-[#F3F4F6]">
          {plans.length === 0 ? (
            <div className="py-12 text-center text-sm text-[#6B7280]">
              Nenhum convênio cadastrado. Adicione o primeiro acima.
            </div>
          ) : (
            plans.map(plan => (
              <div key={plan.id}>
                <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-[#F9FAFB]">
                  <button type="button" onClick={() => setOpenId(openId === plan.id ? null : plan.id)}
                    aria-expanded={openId === plan.id}
                    className="flex flex-1 items-center gap-3 text-left">
                    <div className="w-8 h-8 rounded-lg bg-[#EFF6FF] flex items-center justify-center shrink-0">
                      <Shield className="w-4 h-4 text-[#3B82F6]" />
                    </div>
                    <span className="flex-1 text-sm font-medium text-[#111827]">{plan.name}</span>
                    {!plan.active && (
                      <span className="text-xs font-medium text-[#6B7280] bg-[#F3F4F6] rounded-full px-2 py-0.5">Inativo</span>
                    )}
                    <ChevronDown className={`w-4 h-4 text-[#9CA3AF] transition-transform ${openId === plan.id ? 'rotate-180' : ''}`} />
                  </button>
                  <button onClick={() => handleDelete(plan.id, plan.name)} disabled={deletingId === plan.id}
                    className="p-1.5 rounded-lg text-[#9CA3AF] hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-40">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {openId === plan.id && (
                  <PainelOperadora plan={plan}
                    onSaved={updated => setPlans(prev => prev.map(p => (p.id === updated.id ? updated : p)))} />
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
