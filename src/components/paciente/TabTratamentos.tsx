'use client'

import { useState, useEffect, useRef } from 'react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Plus, X, ChevronDown, Pencil } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import { todayYmd } from '@/lib/messaging/time'
import { SecaoGuias } from '@/components/paciente/SecaoGuias'
import { naTabela } from '@/lib/convenios/guias'
import type {
  Professional, InsurancePlan, Treatment, TreatmentStatus, InsuranceGuide, InsuranceGuideItem,
  InsurancePlanProcedure,
} from '@/types'

// ─── FDI arch arrays ──────────────────────────────────────────────────────────
const UPPER_LEFT  = [18,17,16,15,14,13,12,11]
const UPPER_RIGHT = [21,22,23,24,25,26,27,28]
const LOWER_LEFT  = [48,47,46,45,44,43,42,41]
const LOWER_RIGHT = [31,32,33,34,35,36,37,38]

const FACES = ['V','M','O','D','L','T'] as const
type Face = typeof FACES[number]

const STATUS_CONFIG: Record<TreatmentStatus, { label: string; color: string; bg: string }> = {
  planned:     { label: 'Planejado',    color: '#3B82F6', bg: '#EFF6FF' },
  in_progress: { label: 'Em andamento', color: '#F97316', bg: '#FFF7ED' },
  completed:   { label: 'Concluído',    color: '#22C55E', bg: '#F0FDF4' },
  cancelled:   { label: 'Cancelado',    color: '#EF4444', bg: '#FEF2F2' },
}

type ToothFaces = Record<number, Face[]>

// ─── Selo da guia ─────────────────────────────────────────────────────────────

type Selo = 'Fora da tabela' | 'Sem guia' | 'Aguardando autorização' | 'Autorizado' | 'Negado' | 'Em lote'

const SELO_COLORS: Record<Selo, { color: string; bg: string }> = {
  'Fora da tabela':         { color: '#6B7280', bg: '#F3F4F6' },
  'Sem guia':               { color: '#6B7280', bg: '#F3F4F6' },
  'Aguardando autorização': { color: '#F97316', bg: '#FFF7ED' },
  'Autorizado':             { color: '#16A34A', bg: '#F0FDF4' },
  'Negado':                 { color: '#EF4444', bg: '#FEF2F2' },
  'Em lote':                { color: '#3B82F6', bg: '#EFF6FF' },
}

function seloDoTratamento(
  t: Treatment, items: InsuranceGuideItem[], procById: Map<string, InsurancePlanProcedure>,
): Selo {
  if (!t.insurance_procedure_id || !naTabela(t.insurance_plan_id, procById.get(t.insurance_procedure_id))) {
    return 'Fora da tabela'
  }
  const doTrat = items.filter((i) => i.treatment_id === t.id)
  const ativo = doTrat.find((i) => i.active)
  if (ativo) {
    if (ativo.batch_id) return 'Em lote'
    if (ativo.authorization === 'autorizado' || ativo.authorization === 'nao_exige') return 'Autorizado'
    return 'Aguardando autorização'
  }
  const ultimo = doTrat.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  return ultimo?.authorization === 'negado' ? 'Negado' : 'Sem guia'
}

// ─── Main tab component ───────────────────────────────────────────────────────

interface TabTratamentosProps {
  patientId: string
  clinicId: string
  onTreatmentSaved?: () => void
}

export function TabTratamentos({ patientId, clinicId, onTreatmentSaved }: TabTratamentosProps) {
  const [treatments, setTreatments]       = useState<Treatment[]>([])
  const [professionals, setProfessionals] = useState<Professional[]>([])
  const [insurancePlans, setInsurancePlans] = useState<InsurancePlan[]>([])
  const [loading, setLoading]             = useState(true)
  const [modalOpen, setModalOpen]         = useState(false)
  const [editingTreatment, setEditingTreatment] = useState<Treatment | null>(null)
  const [expandedId, setExpandedId]       = useState<string | null>(null)
  const [guides, setGuides]               = useState<InsuranceGuide[]>([])
  const [procById, setProcById]           = useState<Map<string, InsurancePlanProcedure>>(new Map())
  const [patientCard, setPatientCard]     = useState<{
    planId: string | null; card: string | null; validUntil: string | null
  }>({ planId: null, card: null, validUntil: null })

  useEffect(() => { loadData(true) }, [patientId]) // eslint-disable-line react-hooks/exhaustive-deps

  // spinner só na primeira carga: recargas após mutação mantêm o conteúdo na tela
  async function loadData(showSpinner = false) {
    if (showSpinner) setLoading(true)
    const supabase = createClient()
    const [treatsRes, profsRes, plansRes, guidesRes, patRes] = await Promise.all([
      supabase
        .from('treatments')
        .select('*, professional:professionals(*), insurance_plan:insurance_plans(*), treatment_teeth(*)')
        .eq('patient_id', patientId)
        .order('date', { ascending: false }),
      supabase.from('professionals').select('*').eq('clinic_id', clinicId),
      supabase.from('insurance_plans').select('*').eq('clinic_id', clinicId),
      supabase
        .from('insurance_guides')
        .select('*, items:insurance_guide_items(*)')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false }),
      supabase
        .from('patients')
        .select('insurance_plan_id, insurance_card, insurance_card_valid_until')
        .eq('id', patientId)
        .single(),
    ])
    const treats = (treatsRes.data || []) as Treatment[]
    setTreatments(treats)
    setProfessionals(profsRes.data || [])
    setInsurancePlans(plansRes.data || [])
    setGuides((guidesRes.data || []) as InsuranceGuide[])
    setPatientCard({
      planId: patRes.data?.insurance_plan_id ?? null,
      card: patRes.data?.insurance_card ?? null,
      validUntil: patRes.data?.insurance_card_valid_until ?? null,
    })
    const procIds = Array.from(new Set(treats.map((t) => t.insurance_procedure_id).filter((x): x is string => !!x)))
    if (procIds.length > 0) {
      const { data: procs } = await supabase.from('insurance_plan_procedures').select('*').in('id', procIds)
      setProcById(new Map(((procs || []) as InsurancePlanProcedure[]).map((p) => [p.id, p])))
    } else {
      setProcById(new Map())
    }
    setLoading(false)
  }

  const allItems = guides.flatMap((g) => g.items || [])

  return (
    <div>
      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E5E7EB] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#111827]">Tratamentos</h3>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3B82F6] text-white text-xs font-medium hover:bg-[#2563EB] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Tratamento
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : treatments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <p className="text-sm text-[#9CA3AF]">Nenhum tratamento registrado.</p>
          </div>
        ) : (
          <div className="divide-y divide-[#F3F4F6]">
            {treatments.map((t) => {
              const s = STATUS_CONFIG[t.status] || STATUS_CONFIG.planned
              const expanded = expandedId === t.id
              const teeth = t.treatment_teeth || []
              return (
                <div key={t.id}>
                  <button
                    className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-[#F9FAFB] transition-colors text-left"
                    onClick={() => setExpandedId(expanded ? null : t.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-[#111827]">{t.procedure}</span>
                        <span
                          className="text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: s.bg, color: s.color }}
                        >
                          {s.label}
                        </span>
                        {t.insurance_plan_id && (() => {
                          const selo = seloDoTratamento(t, allItems, procById)
                          return (
                            <span
                              className="text-xs font-medium px-2 py-0.5 rounded-full"
                              style={{ backgroundColor: SELO_COLORS[selo].bg, color: SELO_COLORS[selo].color }}
                            >
                              {selo}
                            </span>
                          )
                        })()}
                      </div>
                      <p className="text-xs text-[#6B7280] mt-0.5">
                        {t.date && format(parseISO(t.date), "dd/MM/yyyy", { locale: ptBR })}
                        {t.professional && ` · ${(t.professional as Professional).name}`}
                        {t.value > 0 && ` · ${formatCurrency(t.value)}`}
                      </p>
                      {teeth.length > 0 && (
                        <p className="text-xs text-[#9CA3AF] mt-0.5">
                          Dentes: {teeth.map(tt => tt.tooth_number).sort((a, b) => a - b).join(', ')}
                        </p>
                      )}
                    </div>
                    <ChevronDown
                      className={`w-4 h-4 text-[#9CA3AF] shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {expanded && (
                    <div className="px-5 pb-4 bg-[#F9FAFB] border-t border-[#F3F4F6] space-y-3 pt-3">
                      {t.insurance_plan && (
                        <InfoLine label="Convênio" value={(t.insurance_plan as InsurancePlan).name} />
                      )}
                      {t.notes && <InfoLine label="Observações" value={t.notes} />}
                      {teeth.length > 0 && (
                        <div>
                          <p className="text-xs text-[#9CA3AF] mb-2">Dentes e faces</p>
                          <div className="flex flex-wrap gap-2">
                            {teeth
                              .slice()
                              .sort((a, b) => a.tooth_number - b.tooth_number)
                              .map(tt => (
                                <span key={tt.id} className="inline-flex items-center gap-1 text-xs bg-white border border-[#E5E7EB] rounded-lg px-2.5 py-1.5">
                                  <span className="font-semibold text-[#374151]">{tt.tooth_number}</span>
                                  {tt.faces.length > 0 && (
                                    <span className="text-[#6B7280]">· {tt.faces.join(', ')}</span>
                                  )}
                                </span>
                              ))}
                          </div>
                        </div>
                      )}
                      <button
                        onClick={() => setEditingTreatment(t)}
                        className="flex items-center gap-1.5 text-xs text-[#3B82F6] hover:underline mt-1"
                      >
                        <Pencil className="w-3 h-3" />
                        Editar tratamento
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {!loading && (
        <SecaoGuias
          patientId={patientId}
          patientPlanId={patientCard.planId}
          insuranceCard={patientCard.card}
          insuranceCardValidUntil={patientCard.validUntil}
          guides={guides}
          treatments={treatments}
          procById={procById}
          plans={insurancePlans}
          professionals={professionals}
          onChanged={() => loadData()}
        />
      )}

      {modalOpen && (
        <ModalNovoTratamento
          patientId={patientId}
          clinicId={clinicId}
          professionals={professionals}
          insurancePlans={insurancePlans}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false)
            loadData()
            onTreatmentSaved?.()
            window.dispatchEvent(new Event('odontoRefresh'))
          }}
        />
      )}

      {editingTreatment && (
        <ModalEditarTratamento
          treatment={editingTreatment}
          professionals={professionals}
          insurancePlans={insurancePlans}
          onClose={() => setEditingTreatment(null)}
          onSaved={() => {
            setEditingTreatment(null)
            loadData()
            onTreatmentSaved?.()
            window.dispatchEvent(new Event('odontoRefresh'))
          }}
        />
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-xs text-[#9CA3AF] w-24 shrink-0">{label}</span>
      <span className="text-xs text-[#374151]">{value}</span>
    </div>
  )
}

// ─── Busca de procedimento na tabela da operadora ────────────────────────────

interface PickerProps {
  planId: string
  text: string
  onText: (v: string) => void
  onPick: (p: InsurancePlanProcedure) => void
  placeholder: string
  required?: boolean
}

function ProcedimentoPicker({ planId, text, onText, onPick, placeholder, required }: PickerProps) {
  const [results, setResults] = useState<InsurancePlanProcedure[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)

  function search(q: string) {
    if (timer.current) clearTimeout(timer.current)
    // vírgula, parênteses e curingas quebrariam o filtro .or() do PostgREST
    const term = q.replace(/[,()%*_\\]/g, ' ').trim()
    const mine = ++seq.current
    timer.current = setTimeout(async () => {
      setSearching(true)
      let query = createClient()
        .from('insurance_plan_procedures')
        .select('*')
        .eq('insurance_plan_id', planId)
        .eq('active', true)
        .order('name')
        .limit(20)
      if (term) query = query.or(`code.ilike.%${term}%,name.ilike.%${term}%`)
      const { data } = await query
      if (mine !== seq.current) return
      setResults((data || []) as InsurancePlanProcedure[])
      setSearching(false)
    }, 250)
  }

  return (
    <div className="relative">
      <input
        type="text" value={text} required={required}
        onChange={e => { onText(e.target.value); setOpen(true); search(e.target.value) }}
        onFocus={() => { setOpen(true); search(text) }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
      />
      {open && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-[#E5E7EB] rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {searching ? (
            <p className="px-3 py-2 text-xs text-[#9CA3AF]">Buscando...</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-[#9CA3AF]">Nenhum procedimento na tabela da operadora.</p>
          ) : (
            results.map(p => (
              <button
                key={p.id} type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onPick(p); setOpen(false) }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[#F3F4F6] flex items-center justify-between gap-3"
              >
                <span className="min-w-0 truncate">
                  <span className="font-medium text-[#111827]">{p.code}</span>
                  <span className="text-[#6B7280]"> · {p.name}</span>
                </span>
                <span className="text-xs text-[#6B7280] shrink-0">{formatCurrency(p.value)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface ModalProps {
  patientId: string
  clinicId: string
  professionals: Professional[]
  insurancePlans: InsurancePlan[]
  onClose: () => void
  onSaved: () => void
}

function ModalNovoTratamento({
  patientId, clinicId, professionals, insurancePlans, onClose, onSaved,
}: ModalProps) {
  const [professionalId, setProfessionalId] = useState(professionals[0]?.id || '')
  const [insurancePlanId, setInsurancePlanId] = useState('')
  const [date, setDate]         = useState(() => todayYmd(new Date(), 'America/Sao_Paulo'))
  const [procedure, setProcedure] = useState('')
  const [procedureId, setProcedureId] = useState<string | null>(null)
  const [value, setValue]       = useState('')
  const [status, setStatus]     = useState<TreatmentStatus>('planned')
  const [notes, setNotes]       = useState('')
  const [toothFaces, setToothFaces] = useState<ToothFaces>({})
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  function toggleTooth(num: number) {
    setToothFaces(prev => {
      if (num in prev) {
        const next = { ...prev }
        delete next[num]
        return next
      }
      return { ...prev, [num]: [] }
    })
  }

  function toggleFace(tooth: number, face: Face) {
    setToothFaces(prev => {
      const current = prev[tooth] || []
      const has = current.includes(face)
      return {
        ...prev,
        [tooth]: has ? current.filter(f => f !== face) : [...current, face],
      }
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!procedure.trim()) { setError('Informe o procedimento.'); return }
    setError('')
    setLoading(true)

    const supabase = createClient()
    const { data: treat, error: insertErr } = await supabase
      .from('treatments')
      .insert({
        clinic_id:        clinicId,
        patient_id:       patientId,
        professional_id:  professionalId || null,
        insurance_plan_id: insurancePlanId || null,
        insurance_procedure_id: insurancePlanId ? procedureId : null,
        procedure:        procedure.trim(),
        value:            parseFloat(value) || 0,
        date,
        status,
        notes:            notes.trim() || null,
      })
      .select()
      .single()

    if (insertErr || !treat) {
      setError('Erro ao salvar tratamento.')
      setLoading(false)
      return
    }

    const teethEntries = Object.entries(toothFaces)
    if (teethEntries.length > 0) {
      const { error: teethErr } = await supabase.from('treatment_teeth').insert(
        teethEntries.map(([tooth, faces]) => ({
          treatment_id: treat.id,
          tooth_number: parseInt(tooth),
          faces,
        }))
      )
      if (teethErr) {
        setError(`Tratamento salvo, mas erro ao registrar dentes: ${teethErr.message}`)
        setLoading(false)
        return
      }
    }

    onSaved()
  }

  const selectedTeeth = Object.keys(toothFaces).map(Number)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[92vh] overflow-y-auto">

        {/* Header */}
        <div className="sticky top-0 bg-white z-10 flex items-center justify-between p-5 border-b border-[#E5E7EB]">
          <h2 className="text-base font-semibold text-[#111827]">Novo Tratamento</h2>
          <button onClick={onClose} className="p-1 rounded text-[#6B7280] hover:text-[#111827]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">

          {/* Profissional + Convênio */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-[#111827] mb-1">Profissional</label>
              <select
                value={professionalId} onChange={e => setProfessionalId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] bg-white"
              >
                <option value="">— selecione —</option>
                {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#111827] mb-1">Convênio</label>
              <select
                value={insurancePlanId}
                onChange={e => { setInsurancePlanId(e.target.value); setProcedureId(null) }}
                className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] bg-white"
              >
                <option value="">Particular</option>
                {insurancePlans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>

          {/* Data + Valor + Status */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-[#111827] mb-1">Data</label>
              <input
                type="date" value={date} onChange={e => setDate(e.target.value)} required
                className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#111827] mb-1">Valor (R$)</label>
              <input
                type="number" min="0" step="0.01" value={value} onChange={e => setValue(e.target.value)}
                placeholder="0,00"
                className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#111827] mb-1">Status</label>
              <select
                value={status} onChange={e => setStatus(e.target.value as TreatmentStatus)}
                className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] bg-white"
              >
                {(Object.entries(STATUS_CONFIG) as [TreatmentStatus, typeof STATUS_CONFIG[TreatmentStatus]][]).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Procedimento */}
          <div>
            <label className="block text-sm font-medium text-[#111827] mb-1">Procedimento *</label>
            {insurancePlanId ? (
              <ProcedimentoPicker
                key={insurancePlanId}
                planId={insurancePlanId} text={procedure} required
                onText={setProcedure}
                onPick={p => { setProcedure(p.name); setProcedureId(p.id); setValue(String(p.value)) }}
                placeholder="Busque por código ou nome na tabela da operadora"
              />
            ) : (
              <input
                type="text" value={procedure} onChange={e => setProcedure(e.target.value)} required
                placeholder="Ex: Canal, Restauração, Extração, Implante..."
                className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
              />
            )}
          </div>

          {/* Observações */}
          <div>
            <label className="block text-sm font-medium text-[#111827] mb-1">Observações</label>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Informações adicionais..."
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] resize-none"
            />
          </div>

          {/* Arcada dental */}
          <div>
            <label className="block text-sm font-medium text-[#111827] mb-2">
              Dentes envolvidos
              <span className="text-xs font-normal text-[#9CA3AF] ml-1">(clique para selecionar)</span>
            </label>
            <div className="bg-[#F9FAFB] rounded-lg border border-[#E5E7EB] p-3">
              <ArchSelector selectedTeeth={selectedTeeth} onToggle={toggleTooth} />
            </div>

            {/* Face selectors per tooth */}
            {selectedTeeth.length > 0 && (
              <div className="mt-3 space-y-2.5">
                <p className="text-xs font-medium text-[#6B7280]">Faces por dente:</p>
                {selectedTeeth.sort((a, b) => a - b).map(tooth => (
                  <div key={tooth} className="flex items-center gap-3 flex-wrap">
                    <span className="text-xs font-semibold text-[#374151] w-8 shrink-0 text-right">
                      {tooth}
                    </span>
                    <div className="flex gap-1.5">
                      {FACES.map(face => {
                        const active = (toothFaces[tooth] || []).includes(face)
                        return (
                          <button
                            key={face}
                            type="button"
                            onClick={() => toggleFace(tooth, face)}
                            title={FACE_TITLES[face]}
                            className={`w-7 h-7 rounded text-xs font-bold transition-colors ${
                              active
                                ? 'bg-[#3B82F6] text-white shadow-sm'
                                : 'bg-white border border-[#E5E7EB] text-[#6B7280] hover:border-[#3B82F6] hover:text-[#3B82F6]'
                            }`}
                          >
                            {face}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button" onClick={onClose}
              className="flex-1 h-10 rounded-lg border border-[#E5E7EB] text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit" disabled={loading}
              className="flex-1 h-10 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-[#2563EB] transition-colors disabled:opacity-50"
            >
              {loading ? 'Salvando...' : 'Salvar tratamento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const FACE_TITLES: Record<Face, string> = {
  V: 'Vestibular',
  M: 'Mesial',
  O: 'Oclusal / Incisal',
  D: 'Distal',
  L: 'Lingual / Palatino',
  T: 'Toda a superfície',
}

// ─── Dental arch selector ─────────────────────────────────────────────────────

function ArchSelector({ selectedTeeth, onToggle }: {
  selectedTeeth: number[]
  onToggle: (n: number) => void
}) {
  return (
    <div className="flex flex-col items-center gap-1 select-none overflow-x-auto">
      {/* Upper arch */}
      <div className="flex items-end gap-0.5">
        {UPPER_LEFT.map(n => (
          <ArchToothBtn key={n} num={n} selected={selectedTeeth.includes(n)} onClick={() => onToggle(n)} />
        ))}
        <div className="self-stretch mx-0.5 border-l border-dashed border-[#CBD5E1]" />
        {UPPER_RIGHT.map(n => (
          <ArchToothBtn key={n} num={n} selected={selectedTeeth.includes(n)} onClick={() => onToggle(n)} />
        ))}
      </div>

      {/* Midline */}
      <div className="w-full border-t border-dashed border-[#CBD5E1] my-0.5" />

      {/* Lower arch */}
      <div className="flex items-start gap-0.5">
        {LOWER_LEFT.map(n => (
          <ArchToothBtn key={n} num={n} selected={selectedTeeth.includes(n)} onClick={() => onToggle(n)} />
        ))}
        <div className="self-stretch mx-0.5 border-l border-dashed border-[#CBD5E1]" />
        {LOWER_RIGHT.map(n => (
          <ArchToothBtn key={n} num={n} selected={selectedTeeth.includes(n)} onClick={() => onToggle(n)} />
        ))}
      </div>
    </div>
  )
}

function ArchToothBtn({ num, selected, onClick }: { num: number; selected: boolean; onClick: () => void }) {
  const fillSeg = selected ? '#BFDBFE' : '#F1F5F9'
  const strkSeg = selected ? '#3B82F6' : '#CBD5E1'
  const fillCtr = selected ? '#3B82F6' : '#E2E8F0'
  const strkCtr = selected ? '#2563EB' : '#CBD5E1'
  return (
    <button
      type="button" onClick={onClick} title={`Dente ${num}`}
      className={`flex flex-col items-center gap-0.5 px-0.5 py-0.5 rounded transition-colors ${
        selected ? 'bg-blue-50' : 'hover:bg-[#F3F4F6]'
      }`}
    >
      <svg width="16" height="16" viewBox="0 0 20 20">
        <path d="M 1,1 H 19 L 10,10 Z" fill={fillSeg} stroke={strkSeg} strokeWidth="0.8" strokeLinejoin="round" />
        <path d="M 19,1 V 19 L 10,10 Z" fill={fillSeg} stroke={strkSeg} strokeWidth="0.8" strokeLinejoin="round" />
        <path d="M 1,19 H 19 L 10,10 Z" fill={fillSeg} stroke={strkSeg} strokeWidth="0.8" strokeLinejoin="round" />
        <path d="M 1,1 V 19 L 10,10 Z" fill={fillSeg} stroke={strkSeg} strokeWidth="0.8" strokeLinejoin="round" />
        <circle cx="10" cy="10" r="4.5" fill={fillCtr} stroke={strkCtr} strokeWidth="0.8" />
      </svg>
      <span className={`text-[7px] font-medium leading-none ${selected ? 'text-[#3B82F6]' : 'text-[#94A3B8]'}`}>
        {num}
      </span>
    </button>
  )
}

// ─── Modal Editar Tratamento ──────────────────────────────────────────────────

interface EditModalProps {
  treatment: Treatment
  professionals: Professional[]
  insurancePlans: InsurancePlan[]
  onClose: () => void
  onSaved: () => void
}

function ModalEditarTratamento({
  treatment, professionals, insurancePlans, onClose, onSaved,
}: EditModalProps) {
  const existingTeeth = treatment.treatment_teeth || []
  const initialToothFaces: ToothFaces = {}
  for (const tt of existingTeeth) {
    initialToothFaces[tt.tooth_number] = (tt.faces as Face[]).filter(
      f => (FACES as readonly string[]).includes(f)
    )
  }

  const [procedure, setProcedure]     = useState(treatment.procedure)
  const [procedureId, setProcedureId] = useState<string | null>(treatment.insurance_procedure_id ?? null)
  const [status, setStatus]           = useState<TreatmentStatus>(treatment.status)
  const [date, setDate]               = useState(treatment.date)
  const [value, setValue]             = useState(String(treatment.value || ''))
  const [professionalId, setProfId]   = useState(treatment.professional_id || '')
  const [insurancePlanId, setPlanId]  = useState(treatment.insurance_plan_id || '')
  const [notes, setNotes]             = useState(treatment.notes || '')
  const [toothFaces, setToothFaces]   = useState<ToothFaces>(initialToothFaces)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState('')

  function toggleTooth(num: number) {
    setToothFaces(prev => {
      if (num in prev) { const n = { ...prev }; delete n[num]; return n }
      return { ...prev, [num]: [] }
    })
  }

  function toggleFace(tooth: number, face: Face) {
    setToothFaces(prev => {
      const cur = prev[tooth] || []
      return { ...prev, [tooth]: cur.includes(face) ? cur.filter(f => f !== face) : [...cur, face] }
    })
  }

  async function handleSave() {
    if (!procedure.trim()) { setError('Informe o procedimento.'); return }
    setError('')
    setLoading(true)
    const supabase = createClient()

    const { error: updErr } = await supabase
      .from('treatments')
      .update({
        procedure: procedure.trim(),
        status,
        date,
        value: parseFloat(value) || 0,
        professional_id: professionalId || null,
        insurance_plan_id: insurancePlanId || null,
        insurance_procedure_id: insurancePlanId ? procedureId : null,
        notes: notes.trim() || null,
      })
      .eq('id', treatment.id)

    if (updErr) { setError('Erro ao salvar.'); setLoading(false); return }

    await supabase.from('treatment_teeth').delete().eq('treatment_id', treatment.id)

    const entries = Object.entries(toothFaces)
    if (entries.length > 0) {
      const { error: tErr } = await supabase.from('treatment_teeth').insert(
        entries.map(([tooth, faces]) => ({
          treatment_id: treatment.id,
          tooth_number: parseInt(tooth),
          faces,
        }))
      )
      if (tErr) { setError(`Erro ao salvar dentes: ${tErr.message}`); setLoading(false); return }
    }

    onSaved()
  }

  const selectedTeeth = Object.keys(toothFaces).map(Number)
  const sc = STATUS_CONFIG[status]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 flex flex-col max-h-[92vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB] shrink-0">
          <div>
            <h2 className="text-base font-semibold text-[#111827]">Editar Tratamento</h2>
            <p className="text-xs text-[#6B7280] mt-0.5">{treatment.procedure}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded text-[#6B7280] hover:text-[#111827]">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4">

          {/* Status — destaque */}
          <div>
            <label className="block text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-2">Status</label>
            <div className="flex flex-wrap gap-2">
              {(Object.entries(STATUS_CONFIG) as [TreatmentStatus, typeof STATUS_CONFIG[TreatmentStatus]][]).map(([k, v]) => (
                <button
                  key={k} type="button"
                  onClick={() => setStatus(k)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all"
                  style={status === k
                    ? { borderColor: v.color, backgroundColor: v.bg, color: v.color }
                    : { borderColor: '#E5E7EB', backgroundColor: 'white', color: '#6B7280' }
                  }
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: v.color }} />
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          {/* Procedimento */}
          <div>
            <label className="block text-sm font-medium text-[#111827] mb-1">Procedimento *</label>
            {insurancePlanId ? (
              <ProcedimentoPicker
                key={insurancePlanId}
                planId={insurancePlanId} text={procedure}
                onText={setProcedure}
                onPick={p => { setProcedure(p.name); setProcedureId(p.id); setValue(String(p.value)) }}
                placeholder="Busque por código ou nome na tabela da operadora"
              />
            ) : (
              <input
                type="text" value={procedure} onChange={e => setProcedure(e.target.value)}
                placeholder="Ex: Canal, Restauração, Extração..."
                className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
              />
            )}
          </div>

          {/* Data + Valor */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-[#111827] mb-1">Data</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]" />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#111827] mb-1">Valor (R$)</label>
              <input type="number" min="0" step="0.01" value={value} onChange={e => setValue(e.target.value)}
                placeholder="0,00"
                className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]" />
            </div>
          </div>

          {/* Profissional + Convênio */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-[#111827] mb-1">Profissional</label>
              <select value={professionalId} onChange={e => setProfId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] bg-white">
                <option value="">— selecione —</option>
                {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#111827] mb-1">Convênio</label>
              <select value={insurancePlanId} onChange={e => { setPlanId(e.target.value); setProcedureId(null) }}
                className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] bg-white">
                <option value="">Particular</option>
                {insurancePlans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>

          {/* Observações */}
          <div>
            <label className="block text-sm font-medium text-[#111827] mb-1">Observações</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="Informações adicionais..."
              className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] resize-none" />
          </div>

          {/* Dentes */}
          <div>
            <label className="block text-sm font-medium text-[#111827] mb-2">
              Dentes envolvidos
              <span className="text-xs font-normal text-[#9CA3AF] ml-1">(clique para selecionar/deselecionar)</span>
            </label>
            <div className="bg-[#F9FAFB] rounded-lg border border-[#E5E7EB] p-3">
              <ArchSelector selectedTeeth={selectedTeeth} onToggle={toggleTooth} />
            </div>
            {selectedTeeth.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-xs font-medium text-[#6B7280]">Faces por dente:</p>
                {selectedTeeth.sort((a, b) => a - b).map(tooth => (
                  <div key={tooth} className="flex items-center gap-3 flex-wrap">
                    <span className="text-xs font-semibold text-[#374151] w-8 shrink-0 text-right">{tooth}</span>
                    <div className="flex gap-1.5">
                      {FACES.map(face => {
                        const active = (toothFaces[tooth] || []).includes(face)
                        return (
                          <button key={face} type="button" onClick={() => toggleFace(tooth, face)}
                            title={FACE_TITLES[face]}
                            className={`w-7 h-7 rounded text-xs font-bold transition-colors ${
                              active
                                ? 'bg-[#3B82F6] text-white'
                                : 'bg-white border border-[#E5E7EB] text-[#6B7280] hover:border-[#3B82F6] hover:text-[#3B82F6]'
                            }`}>
                            {face}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>}
        </div>

        {/* Footer — botão salvar sempre visível */}
        <div className="px-5 py-4 border-t border-[#E5E7EB] shrink-0 flex gap-3">
          <button type="button" onClick={onClose}
            className="h-11 px-5 rounded-lg border border-[#E5E7EB] text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] transition-colors">
            Cancelar
          </button>
          <button
            type="button" onClick={handleSave} disabled={loading}
            className="flex-1 h-11 rounded-lg text-white text-sm font-semibold transition-colors disabled:opacity-50"
            style={{ backgroundColor: sc.color }}
          >
            {loading ? 'Salvando...' : `Salvar como ${sc.label}`}
          </button>
        </div>
      </div>
    </div>
  )
}
