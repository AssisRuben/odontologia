'use client'

import { useState, useEffect, useRef } from 'react'
import { Plus, X, ChevronDown, ChevronUp, ClipboardList, Wand2, Loader2 } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'
import { BarraVoz } from '@/components/ia/BarraVoz'
import { useIaStatus } from '@/components/ia/useIaStatus'
import { mesclarAnamnese, conflitosAnamnese, type IaAnamnese } from '@/lib/ia/anamnese/respostas'
import { appendText } from '@/lib/ia/texto'
import type { AnamnesisTemplate, AnamnesisQuestion } from '@/types'

interface Anamnese {
  id: string
  patient_id: string
  template_id: string | null
  answers: Record<string, string>
  notes: string | null
  ai_used: boolean
  created_at: string
  template?: AnamnesisTemplate
}

interface Props {
  patientId: string
  clinicId: string
}

export function TabAnamneses({ patientId, clinicId }: Props) {
  const [anamneses, setAnamneses]   = useState<Anamnese[]>([])
  const [templates, setTemplates]   = useState<AnamnesisTemplate[]>([])
  const [loading, setLoading]       = useState(true)
  const [showModal, setShowModal]   = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  async function load() {
    const supabase = createClient()
    const [aRes, tRes] = await Promise.all([
      supabase.from('anamneses').select('*, template:anamnesis_templates(*)').eq('patient_id', patientId).order('created_at', { ascending: false }),
      supabase.from('anamnesis_templates').select('*').eq('clinic_id', clinicId).order('name'),
    ])
    if (aRes.data) setAnamneses(aRes.data)
    if (tRes.data) setTemplates(tRes.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [patientId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-7 h-7 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-[#6B7280]">{anamneses.length} anamnese(s) registrada(s)</p>
        <button onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-4 h-9 bg-[#3B82F6] text-white text-sm font-medium rounded-lg hover:bg-[#2563EB] transition-colors">
          <Plus className="w-4 h-4" /> Nova anamnese
        </button>
      </div>

      {anamneses.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#E5E7EB] flex flex-col items-center justify-center h-48 gap-3">
          <ClipboardList className="w-10 h-10 text-[#D1D5DB]" />
          <p className="text-sm text-[#6B7280]">Nenhuma anamnese preenchida ainda.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {anamneses.map((a) => {
            const expanded = expandedId === a.id
            const questions: AnamnesisQuestion[] = a.template?.questions || []
            return (
              <div key={a.id} className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
                <button
                  onClick={() => setExpandedId(expanded ? null : a.id)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-[#F9FAFB] transition-colors"
                >
                  <div>
                    <p className="text-sm font-semibold text-[#111827]">
                      {a.template?.name || 'Anamnese'}
                    </p>
                    <p className="text-xs text-[#6B7280] mt-0.5">
                      {format(parseISO(a.created_at), "d 'de' MMMM 'de' yyyy", { locale: ptBR })}
                      {' · '}{questions.length} pergunta(s)
                    </p>
                  </div>
                  {expanded ? <ChevronUp className="w-4 h-4 text-[#6B7280]" /> : <ChevronDown className="w-4 h-4 text-[#6B7280]" />}
                </button>

                {expanded && (
                  <div className="px-5 pb-4 border-t border-[#F3F4F6] space-y-3 pt-4">
                    {questions.map((q) => (
                      <div key={q.id}>
                        <p className="text-xs font-medium text-[#6B7280] mb-0.5">{q.text}</p>
                        <p className="text-sm text-[#111827]">{a.answers[q.id] || '—'}</p>
                      </div>
                    ))}
                    {a.notes && (
                      <div className="mt-2 pt-3 border-t border-[#F3F4F6]">
                        <p className="text-xs font-medium text-[#6B7280] mb-0.5">Observações</p>
                        <p className="text-sm text-[#374151]">{a.notes}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showModal && (
        <ModalNovaAnamnese
          patientId={patientId}
          clinicId={clinicId}
          templates={templates}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load() }}
        />
      )}
    </div>
  )
}

// ─── Modal nova anamnese ──────────────────────────────────────────────────────

// Respostas, selos "IA" e ai_used andam juntos: o preenchimento da IA é calculado
// sobre o estado atual (inclusive cliques feitos durante a requisição).
interface Respostas {
  answers: Record<string, string>
  iaIds: string[]
  aiUsed: boolean
}

const RESPOSTAS_VAZIAS: Respostas = { answers: {}, iaIds: [], aiUsed: false }

function ModalNovaAnamnese({ patientId, clinicId, templates, onClose, onSaved }: {
  patientId: string
  clinicId: string
  templates: AnamnesisTemplate[]
  onClose: () => void
  onSaved: () => void
}) {
  const [selectedTemplateId, setSelectedTemplateId] = useState(templates[0]?.id || '')
  const [respostas, setRespostas] = useState<Respostas>(RESPOSTAS_VAZIAS)
  const { answers, iaIds, aiUsed } = respostas
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [erroSalvar, setErroSalvar] = useState('')
  const { conectado } = useIaStatus()
  const [ditado, setDitado] = useState('')
  const [vozOcupada, setVozOcupada] = useState(false)
  const [preenchendo, setPreenchendo] = useState(false)
  const [erroIa, setErroIa] = useState('')

  const template = templates.find(t => t.id === selectedTemplateId)
  // Respostas mais recentes, para comparar com a fala quando a IA responder.
  const answersRef = useRef(answers)
  useEffect(() => { answersRef.current = answers }, [answers])

  function setResposta(id: string, valor: string) {
    setRespostas(r => ({ ...r, answers: { ...r.answers, [id]: valor }, iaIds: r.iaIds.filter(x => x !== id) }))
  }

  async function handlePreencher() {
    setErroIa('')
    setPreenchendo(true)
    try {
      const res = await fetch('/api/ia/anamnese/preencher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: selectedTemplateId, texto: ditado }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || typeof j.respostas !== 'object' || j.respostas === null) {
        setErroIa(typeof j.error === 'string' ? j.error : 'Não foi possível organizar agora. Tente de novo.')
        return
      }
      const ia: IaAnamnese = {
        respostas: j.respostas,
        observacoes: typeof j.observacoes === 'string' ? j.observacoes : null,
      }
      setRespostas(r => {
        const m = mesclarAnamnese(r.answers, '', ia)
        return {
          answers: m.answers,
          iaIds: [...new Set([...r.iaIds, ...m.preenchidas])],
          aiUsed: r.aiUsed || m.preenchidas.length > 0 || !!ia.observacoes,
        }
      })
      const avisos = conflitosAnamnese(answersRef.current, ia, template?.questions ?? [])
      const extra = [ia.observacoes, ...avisos].filter(Boolean).join('\n') || null
      setNotes(n => mesclarAnamnese({}, n, { respostas: {}, observacoes: extra }).notes)
    } catch {
      setErroIa('Não foi possível organizar agora. Tente de novo.')
    } finally {
      setPreenchendo(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setErroSalvar('')
    const supabase = createClient()
    const { error } = await supabase.from('anamneses').insert({
      clinic_id: clinicId,
      patient_id: patientId,
      template_id: selectedTemplateId || null,
      answers,
      notes: notes || null,
      ai_used: aiUsed,
    })
    setSaving(false)
    if (error) {
      setErroSalvar(`Erro ao salvar: ${error.message}`)
      return
    }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[#E5E7EB] shrink-0">
          <h2 className="text-base font-semibold text-[#111827]">Nova anamnese</h2>
          <button onClick={onClose} className="p-1 rounded text-[#9CA3AF] hover:text-[#374151]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {templates.length > 1 && (
            <div>
              <label className="block text-sm font-medium text-[#111827] mb-1">Modelo</label>
              <select value={selectedTemplateId} disabled={preenchendo}
                onChange={e => { setSelectedTemplateId(e.target.value); setRespostas(RESPOSTAS_VAZIAS) }}
                className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] bg-white disabled:opacity-50">
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}

          {templates.length === 0 && (
            <p className="text-sm text-[#6B7280] bg-[#F9FAFB] rounded-lg p-3">
              Nenhum modelo de anamnese cadastrado. Crie um em Configurações → Modelos de anamnese.
            </p>
          )}

          {template && (
            <div>
              <label className="block text-sm font-medium text-[#111827] mb-1">Preencher por voz</label>
              <div className="mb-2">
                <BarraVoz
                  gravarDisponivel={conectado}
                  onTexto={(t) => (conectado ? setDitado((d) => appendText(d, t)) : setNotes((n) => appendText(n, t)))}
                  disabled={preenchendo || saving}
                  onOcupado={setVozOcupada}
                />
              </div>
              {conectado && (<>
              <textarea value={ditado} readOnly={preenchendo} onChange={e => setDitado(e.target.value)} rows={3}
                placeholder="Dite ou escreva as respostas do paciente..."
                className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] resize-none" />
              <button type="button" onClick={handlePreencher}
                disabled={preenchendo || saving || vozOcupada || !selectedTemplateId || !ditado.trim()}
                className="mt-2 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[#3B82F6] bg-[#EFF6FF] text-sm font-medium text-[#3B82F6] hover:bg-[#DBEAFE] disabled:opacity-50">
                {preenchendo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                {preenchendo ? 'Preenchendo…' : 'Preencher com IA'}
              </button>
              {erroIa && <p className="mt-1.5 text-sm text-red-600">{erroIa}</p>}
              </>)}
            </div>
          )}

          {template?.questions.map((q) => (
            <div key={q.id}>
              <label className="block text-sm font-medium text-[#111827] mb-1">
                {q.text}
                {iaIds.includes(q.id) && (
                  <span className="ml-2 px-1.5 py-0.5 rounded bg-[#EFF6FF] text-[#3B82F6] text-[10px] font-semibold align-middle">IA</span>
                )}
              </label>
              {q.type === 'yesno' ? (
                <div className="flex gap-2">
                  {['Sim', 'Não'].map(opt => (
                    <button key={opt} type="button"
                      onClick={() => setResposta(q.id, opt)}
                      className={`px-4 h-9 rounded-lg border text-sm font-medium transition-colors ${answers[q.id] === opt ? 'bg-[#3B82F6] text-white border-[#3B82F6]' : 'border-[#E5E7EB] text-[#374151] hover:border-[#3B82F6]'}`}>
                      {opt}
                    </button>
                  ))}
                </div>
              ) : q.type === 'options' ? (
                <div className="flex flex-wrap gap-2">
                  {(q.options || []).map(opt => (
                    <button key={opt} type="button"
                      onClick={() => setResposta(q.id, opt)}
                      className={`px-3 h-8 rounded-lg border text-sm transition-colors ${answers[q.id] === opt ? 'bg-[#3B82F6] text-white border-[#3B82F6]' : 'border-[#E5E7EB] text-[#374151] hover:border-[#3B82F6]'}`}>
                      {opt}
                    </button>
                  ))}
                </div>
              ) : (
                <textarea value={answers[q.id] || ''} onChange={e => setResposta(q.id, e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] resize-none" />
              )}
            </div>
          ))}

          <div>
            <label className="block text-sm font-medium text-[#111827] mb-1">Observações gerais</label>
            <textarea value={notes} readOnly={preenchendo} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder="Observações adicionais..."
              className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] resize-none" />
          </div>
        </div>

        {erroSalvar && <p className="px-5 pt-3 text-sm text-red-600">{erroSalvar}</p>}
        <div className="p-5 border-t border-[#E5E7EB] flex gap-3 shrink-0">
          <button onClick={onClose}
            className="flex-1 h-10 rounded-lg border border-[#E5E7EB] text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6]">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving || preenchendo || vozOcupada || templates.length === 0}
            className="flex-1 h-10 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-[#2563EB] disabled:opacity-50">
            {saving ? 'Salvando...' : 'Salvar anamnese'}
          </button>
        </div>
      </div>
    </div>
  )
}
