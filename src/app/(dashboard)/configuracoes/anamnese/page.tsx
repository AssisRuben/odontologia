'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ChevronLeft, Plus, Trash2, X, GripVertical, CheckSquare, AlignLeft, List } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'

interface Question {
  id: string
  text: string
  type: 'text' | 'yesno' | 'options'
  options?: string[]
}

interface AnamnesisTemplate {
  id: string
  clinic_id: string
  name: string
  questions: Question[]
  created_at: string
}

const QUESTION_TYPE_LABELS = { text: 'Texto livre', yesno: 'Sim / Não', options: 'Múltipla escolha' }
const QUESTION_TYPE_ICONS = {
  text: AlignLeft,
  yesno: CheckSquare,
  options: List,
}

function newQuestion(): Question {
  return { id: crypto.randomUUID(), text: '', type: 'yesno' }
}

export default function AnamnesesPage() {
  const { clinicId } = useClinicStore()
  const [templates, setTemplates] = useState<AnamnesisTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<AnamnesisTemplate | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [questions, setQuestions] = useState<Question[]>([newQuestion()])
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function load() {
    if (!clinicId) return
    const supabase = createClient()
    const { data } = await supabase.from('anamnesis_templates').select('*').eq('clinic_id', clinicId).order('created_at')
    if (data) setTemplates(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [clinicId]) // eslint-disable-line react-hooks/exhaustive-deps

  function openNew() {
    setEditing(null)
    setTemplateName('')
    setQuestions([newQuestion()])
    setError('')
    setShowForm(true)
  }

  function openEdit(t: AnamnesisTemplate) {
    setEditing(t)
    setTemplateName(t.name)
    setQuestions(t.questions.length > 0 ? t.questions : [newQuestion()])
    setError('')
    setShowForm(true)
  }

  function closeForm() { setShowForm(false); setEditing(null); setError('') }

  function addQuestion() { setQuestions(q => [...q, newQuestion()]) }

  function removeQuestion(id: string) {
    setQuestions(q => q.length > 1 ? q.filter(x => x.id !== id) : q)
  }

  function updateQuestion(id: string, patch: Partial<Question>) {
    setQuestions(q => q.map(x => x.id === id ? { ...x, ...patch } : x))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!templateName.trim()) { setError('Nome do modelo é obrigatório.'); return }
    const validQuestions = questions.filter(q => q.text.trim())
    if (validQuestions.length === 0) { setError('Adicione ao menos uma pergunta.'); return }
    setError('')
    setSaving(true)
    const supabase = createClient()

    if (editing) {
      await supabase.from('anamnesis_templates').update({
        name: templateName.trim(), questions: validQuestions,
      }).eq('id', editing.id)
    } else {
      await supabase.from('anamnesis_templates').insert({
        clinic_id: clinicId, name: templateName.trim(), questions: validQuestions,
      })
    }
    setSaving(false)
    closeForm()
    load()
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    const supabase = createClient()
    await supabase.from('anamnesis_templates').delete().eq('id', id)
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
          <h1 className="text-xl font-semibold text-[#111827]">Modelos de anamnese</h1>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-1.5 px-4 h-9 bg-[#3B82F6] text-white text-sm font-medium rounded-lg hover:bg-[#2563EB] transition-colors">
          <Plus className="w-4 h-4" /> Novo modelo
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {templates.length === 0 ? (
            <div className="bg-white rounded-xl border border-[#E5E7EB] py-12 text-center text-sm text-[#6B7280]">
              Nenhum modelo criado ainda. Crie o primeiro acima.
            </div>
          ) : (
            templates.map(t => (
              <div key={t.id} className="bg-white rounded-xl border border-[#E5E7EB] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#111827]">{t.name}</p>
                    <p className="text-xs text-[#6B7280] mt-0.5">{t.questions.length} pergunta{t.questions.length !== 1 ? 's' : ''}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {t.questions.slice(0, 3).map(q => (
                        <span key={q.id} className="text-xs bg-[#F3F4F6] text-[#374151] px-2 py-0.5 rounded-full truncate max-w-[180px]">
                          {q.text || '—'}
                        </span>
                      ))}
                      {t.questions.length > 3 && (
                        <span className="text-xs text-[#9CA3AF]">+{t.questions.length - 3} mais</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => openEdit(t)}
                      className="px-3 h-8 rounded-lg text-xs font-medium border border-[#E5E7EB] text-[#374151] hover:bg-[#F3F4F6] transition-colors">
                      Editar
                    </button>
                    <button onClick={() => handleDelete(t.id)} disabled={deletingId === t.id}
                      className="p-1.5 rounded-lg text-[#9CA3AF] hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-40">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Modal editor */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={closeForm} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-xl mx-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-[#E5E7EB] shrink-0">
              <h2 className="text-base font-semibold text-[#111827]">
                {editing ? 'Editar modelo' : 'Novo modelo de anamnese'}
              </h2>
              <button onClick={closeForm} className="p-1 rounded text-[#9CA3AF] hover:text-[#374151]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-5 space-y-5">
              <div>
                <label className="block text-sm font-medium text-[#111827] mb-1">Nome do modelo *</label>
                <input value={templateName} onChange={e => setTemplateName(e.target.value)}
                  placeholder="Ex: Anamnese Geral, Anamnese Infantil..."
                  className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]" />
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-[#111827]">Perguntas</label>
                  <button type="button" onClick={addQuestion}
                    className="flex items-center gap-1 text-xs text-[#3B82F6] hover:text-[#2563EB] font-medium">
                    <Plus className="w-3.5 h-3.5" /> Adicionar pergunta
                  </button>
                </div>
                <div className="space-y-3">
                  {questions.map((q, i) => {
                    const Icon = QUESTION_TYPE_ICONS[q.type]
                    return (
                      <div key={q.id} className="flex gap-2 items-start">
                        <GripVertical className="w-4 h-4 text-[#D1D5DB] mt-2.5 shrink-0" />
                        <div className="flex-1 bg-[#F9FAFB] rounded-lg border border-[#E5E7EB] p-3 space-y-2">
                          <input
                            value={q.text}
                            onChange={e => updateQuestion(q.id, { text: e.target.value })}
                            placeholder={`Pergunta ${i + 1}`}
                            className="w-full bg-transparent text-sm text-[#111827] placeholder-[#9CA3AF] focus:outline-none"
                          />
                          <div className="flex gap-1.5">
                            {(['yesno', 'text', 'options'] as const).map(type => {
                              const TIcon = QUESTION_TYPE_ICONS[type]
                              return (
                                <button key={type} type="button"
                                  onClick={() => updateQuestion(q.id, { type })}
                                  className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${q.type === type ? 'bg-[#3B82F6] text-white' : 'bg-white border border-[#E5E7EB] text-[#6B7280] hover:border-[#3B82F6] hover:text-[#3B82F6]'}`}
                                >
                                  <TIcon className="w-3 h-3" />
                                  {QUESTION_TYPE_LABELS[type]}
                                </button>
                              )
                            })}
                          </div>
                          {q.type === 'options' && (
                            <input
                              value={q.options?.join(', ') || ''}
                              onChange={e => updateQuestion(q.id, { options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                              placeholder="Opção 1, Opção 2, Opção 3..."
                              className="w-full bg-white border border-[#E5E7EB] rounded px-2 py-1 text-xs text-[#374151] focus:outline-none focus:ring-1 focus:ring-[#3B82F6]"
                            />
                          )}
                        </div>
                        <button type="button" onClick={() => removeQuestion(q.id)}
                          className="p-1.5 mt-1 rounded text-[#D1D5DB] hover:text-red-400 transition-colors shrink-0">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>

              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            </form>

            <div className="p-5 border-t border-[#E5E7EB] flex gap-3 shrink-0">
              <button type="button" onClick={closeForm}
                className="flex-1 h-10 rounded-lg border border-[#E5E7EB] text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6]">
                Cancelar
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 h-10 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-[#2563EB] disabled:opacity-50">
                {saving ? 'Salvando...' : editing ? 'Salvar' : 'Criar modelo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
