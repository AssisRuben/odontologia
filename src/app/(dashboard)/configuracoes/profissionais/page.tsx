'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ChevronLeft, Plus, Pencil, Trash2, X, CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import type { Professional } from '@/types'

const COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#06B6D4', '#EC4899', '#F97316', '#14B8A6', '#6366F1',
]

interface FormState {
  name: string
  cro: string
  specialty: string
  color: string
}

const emptyForm: FormState = { name: '', cro: '', specialty: '', color: COLORS[0] }

export default function ProfissionaisPage() {
  const { clinicId } = useClinicStore()
  const [professionals, setProfessionals] = useState<Professional[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Professional | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
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
    setError('')
    setShowForm(true)
  }

  function openEdit(p: Professional) {
    setEditing(p)
    setForm({ name: p.name, cro: p.cro || '', specialty: p.specialty || '', color: p.color })
    setError('')
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditing(null)
    setError('')
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Nome é obrigatório.'); return }
    setError('')
    setSaving(true)
    const supabase = createClient()

    if (editing) {
      const { error: err } = await supabase.from('professionals').update({
        name: form.name.trim(), cro: form.cro || null,
        specialty: form.specialty || null, color: form.color,
      }).eq('id', editing.id)
      if (err) { setError(`Erro: ${err.message}`); setSaving(false); return }
    } else {
      const { error: err } = await supabase.from('professionals').insert({
        clinic_id: clinicId, name: form.name.trim(),
        cro: form.cro || null, specialty: form.specialty || null, color: form.color,
      })
      if (err) { setError(`Erro: ${err.message}`); setSaving(false); return }
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
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
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
              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
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
