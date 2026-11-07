'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ChevronLeft, Plus, Pencil, Trash2, X, CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import type { Professional } from '@/types'
import { normalizeWorkingHours } from '@/lib/agente/agendamento/config'

type Periodos = [string, string][]
type Semana = Record<string, Periodos>

const DIAS: { key: string; label: string }[] = [
  { key: '1', label: 'Segunda' },
  { key: '2', label: 'Terça' },
  { key: '3', label: 'Quarta' },
  { key: '4', label: 'Quinta' },
  { key: '5', label: 'Sexta' },
  { key: '6', label: 'Sábado' },
  { key: '0', label: 'Domingo' },
]
const timeCls = 'h-9 px-2 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] disabled:opacity-40'

function paraSemana(raw: unknown): Semana {
  const n = normalizeWorkingHours(raw)
  const out: Semana = {}
  for (const d of DIAS) {
    const r = n[d.key as keyof typeof n]
    out[d.key] = r ? r.map(x => [x[0], x[1]] as [string, string]) : []
  }
  return out
}

const COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#06B6D4', '#EC4899', '#F97316', '#14B8A6', '#6366F1',
]

interface FormState {
  name: string
  cro: string
  specialty: string
  color: string
  whatsapp: boolean
}

const emptyForm: FormState = { name: '', cro: '', specialty: '', color: COLORS[0], whatsapp: false }

export default function ProfissionaisPage() {
  const { clinicId } = useClinicStore()
  const [professionals, setProfessionals] = useState<Professional[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Professional | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [semana, setSemana] = useState<Semana>(() => paraSemana(null))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function load() {
    if (!clinicId) return
    const supabase = createClient()
    const { data } = await supabase.from('professionals').select('*').eq('clinic_id', clinicId).order('name')
    if (data) setProfessionals(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [clinicId]) // eslint-disable-line react-hooks/exhaustive-deps

  function openNew() {
    setEditing(null)
    setForm(emptyForm)
    setSemana(paraSemana(null))
    setError('')
    setShowForm(true)
  }

  function openEdit(p: Professional) {
    setEditing(p)
    setForm({ name: p.name, cro: p.cro || '', specialty: p.specialty || '', color: p.color, whatsapp: !!p.whatsapp_booking })
    setSemana(paraSemana(p.working_hours))
    setError('')
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditing(null)
    setError('')
  }

  function setPeriodo(day: string, idx: number, pos: 0 | 1, value: string) {
    setSemana(s => ({ ...s, [day]: s[day].map((r, i) => (i === idx ? (pos === 0 ? [value, r[1]] : [r[0], value]) as [string, string] : r)) }))
  }

  function setNaoAtende(day: string, off: boolean) {
    setSemana(s => ({ ...s, [day]: off ? [] : [['08:00', '12:00']] }))
  }

  function addPeriodo(day: string) {
    setSemana(s => (s[day].length >= 2 ? s : { ...s, [day]: [...s[day], ['14:00', '18:00']] }))
  }

  function removePeriodo(day: string, idx: number) {
    setSemana(s => ({ ...s, [day]: s[day].filter((_, i) => i !== idx) }))
  }

  function copiarSegunda() {
    const seg = () => semana['1'].map(r => [r[0], r[1]] as [string, string])
    setSemana(s => ({ ...s, '2': seg(), '3': seg(), '4': seg(), '5': seg() }))
  }

  function validarSemana(): string {
    for (const d of DIAS) {
      const ps = semana[d.key]
      for (const r of ps) {
        if (!r[0] || !r[1] || r[0] >= r[1]) return `Horário de ${d.label} inválido: o início deve ser antes do fim.`
      }
      if (ps.length === 2) {
        const o = [...ps].sort((a, b) => (a[0] < b[0] ? -1 : 1))
        if (o[0][1] > o[1][0]) return `Os períodos de ${d.label} não podem se sobrepor.`
      }
    }
    return ''
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Nome é obrigatório.'); return }
    const erroSemana = form.whatsapp ? validarSemana() : ''
    if (erroSemana) { setError(erroSemana); return }
    setError('')
    setSaving(true)
    const supabase = createClient()
    let profId: string | null = editing?.id ?? null

    if (editing) {
      const { error: err } = await supabase.from('professionals').update({
        name: form.name.trim(), cro: form.cro || null,
        specialty: form.specialty || null, color: form.color,
      }).eq('id', editing.id)
      if (err) { setError(`Erro: ${err.message}`); setSaving(false); return }
    } else {
      const { data: novo, error: err } = await supabase.from('professionals').insert({
        clinic_id: clinicId, name: form.name.trim(),
        cro: form.cro || null, specialty: form.specialty || null, color: form.color,
      }).select('*').single()
      if (err || !novo) { setError(`Erro: ${err?.message ?? 'não foi possível criar'}`); setSaving(false); return }
      profId = (novo as Professional).id
      setEditing(novo as Professional)
      load()
    }

    if (profId && (editing || form.whatsapp)) {
      // Sem "Atende pelo WhatsApp" o horário editado não foi validado: mantém o salvo (normalizado).
      let hours: Record<string, Periodos> = {}
      if (form.whatsapp) {
        for (const d of DIAS) if (semana[d.key].length) hours[d.key] = semana[d.key]
      } else {
        hours = normalizeWorkingHours(editing?.working_hours ?? null) as Record<string, Periodos>
      }
      try {
        const res = await fetch(`/api/profissionais/${profId}/agenda`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ whatsapp_booking: form.whatsapp, working_hours: hours }),
        })
        const data = await res.json().catch(() => ({})) as { error?: string }
        if (!res.ok) {
          setError(data.error || 'Não foi possível salvar o horário.')
          setSaving(false)
          load()
          return
        }
      } catch {
        setError('Não foi possível salvar o horário. Verifique sua conexão.')
        setSaving(false)
        load()
        return
      }
    }

    setSaving(false)
    closeForm()
    load()
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    const supabase = createClient()
    await supabase.from('professionals').delete().eq('id', id)
    setDeletingId(null)
    load()
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/configuracoes" className="p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280]">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-xl font-semibold text-[#111827]">Gestão de profissionais</h1>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-1.5 px-4 h-9 bg-[#3B82F6] text-white text-sm font-medium rounded-lg hover:bg-[#2563EB] transition-colors"
        >
          <Plus className="w-4 h-4" /> Novo profissional
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#E5E7EB] divide-y divide-[#F3F4F6]">
          {professionals.length === 0 ? (
            <div className="py-12 text-center text-sm text-[#6B7280]">
              Nenhum profissional cadastrado ainda.
            </div>
          ) : (
            professionals.map((p) => (
              <div key={p.id} className="flex items-center gap-4 px-5 py-4">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                  style={{ backgroundColor: p.color }}>
                  {p.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#111827]">{p.name}</p>
                  <p className="text-xs text-[#6B7280]">
                    {[p.specialty, p.cro ? `CRO: ${p.cro}` : ''].filter(Boolean).join(' · ') || 'Sem especialidade informada'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => openEdit(p)}
                    className="p-1.5 rounded-lg text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#374151] transition-colors">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDelete(p.id)} disabled={deletingId === p.id}
                    className="p-1.5 rounded-lg text-[#6B7280] hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-40">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Modal form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={closeForm} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-[#E5E7EB]">
              <h2 className="text-base font-semibold text-[#111827]">
                {editing ? 'Editar profissional' : 'Novo profissional'}
              </h2>
              <button onClick={closeForm} className="p-1 rounded text-[#9CA3AF] hover:text-[#374151]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#111827] mb-1">Nome *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
                  placeholder="Dr. João Silva" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-[#111827] mb-1">CRO</label>
                  <input value={form.cro} onChange={e => setForm(f => ({ ...f, cro: e.target.value }))}
                    className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
                    placeholder="SP-12345" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#111827] mb-1">Especialidade</label>
                  <input value={form.specialty} onChange={e => setForm(f => ({ ...f, specialty: e.target.value }))}
                    className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
                    placeholder="Ortodontia" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#111827] mb-2">Cor na agenda</label>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))}
                      className="w-8 h-8 rounded-full transition-transform hover:scale-110"
                      style={{
                        backgroundColor: c,
                        outline: form.color === c ? `3px solid ${c}` : 'none',
                        outlineOffset: 2,
                      }} />
                  ))}
                </div>
              </div>
              <div className="border-t border-[#E5E7EB] pt-4 space-y-3">
                <label className="flex items-center justify-between gap-3 text-sm font-medium text-[#111827]">
                  Atende pelo WhatsApp
                  <input type="checkbox" role="switch" checked={form.whatsapp}
                    onChange={e => setForm(f => ({ ...f, whatsapp: e.target.checked }))}
                    className="w-5 h-5 accent-[#3B82F6]" />
                </label>
                {form.whatsapp && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-[#6B7280]">Horários que o agente pode oferecer</p>
                      <button type="button" onClick={copiarSegunda} className="text-xs text-[#3B82F6] hover:underline">
                        Copiar segunda para os dias úteis
                      </button>
                    </div>
                    {DIAS.map(d => {
                      const ps = semana[d.key]
                      return (
                        <div key={d.key} className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="w-16 text-[#111827]">{d.label}</span>
                          <label className="flex items-center gap-1.5 text-[#6B7280]">
                            <input type="checkbox" checked={ps.length === 0}
                              onChange={e => setNaoAtende(d.key, e.target.checked)} className="accent-[#3B82F6]" />
                            Não atende
                          </label>
                          {ps.map((r, i) => (
                            <span key={i} className="flex items-center gap-1">
                              <input type="time" aria-label={`${d.label}: período ${i + 1} começa às`} value={r[0]}
                                onChange={e => setPeriodo(d.key, i, 0, e.target.value)} className={timeCls} />
                              <span className="text-[#6B7280]">às</span>
                              <input type="time" aria-label={`${d.label}: período ${i + 1} termina às`} value={r[1]}
                                onChange={e => setPeriodo(d.key, i, 1, e.target.value)} className={timeCls} />
                              {ps.length > 1 && (
                                <button type="button" aria-label={`${d.label}: remover período ${i + 1}`}
                                  onClick={() => removePeriodo(d.key, i)} className="p-1 text-[#9CA3AF] hover:text-red-500">
                                  <X className="w-4 h-4" />
                                </button>
                              )}
                            </span>
                          ))}
                          {ps.length > 0 && ps.length < 2 && (
                            <button type="button" onClick={() => addPeriodo(d.key)} className="text-xs text-[#3B82F6] hover:underline">
                              + período
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
              {error && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={closeForm}
                  className="flex-1 h-10 rounded-lg border border-[#E5E7EB] text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6]">
                  Cancelar
                </button>
                <button type="submit" disabled={saving}
                  className="flex-1 h-10 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-[#2563EB] disabled:opacity-50">
                  {saving ? 'Salvando...' : editing ? 'Salvar' : 'Criar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
