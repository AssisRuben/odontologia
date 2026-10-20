'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ChevronLeft, Phone, Edit2, Tag, Plus, ClipboardList,
  Calendar, CheckCircle2, AlertCircle, Clock, User2,
} from 'lucide-react'
import { format, parseISO, differenceInYears } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'
import { getInitials, formatPhone, formatCurrency } from '@/lib/utils'
import {
  parsePatientNotes, serializePatientNotes,
} from '@/types'
import type { Patient, Appointment, Payment, Prosthetic } from '@/types'
import { Odontograma } from '@/components/paciente/Odontograma'
import { ModalCategoria, CATEGORIA_COLORS } from '@/components/paciente/ModalCategoria'
import { ModalEditarPaciente } from '@/components/paciente/ModalEditarPaciente'
import { TabAnamneses } from '@/components/paciente/TabAnamneses'
import { TabOrcamentos } from '@/components/paciente/TabOrcamentos'
import { TabDocumentos } from '@/components/paciente/TabDocumentos'
import { TabTratamentos } from '@/components/paciente/TabTratamentos'
import { useClinicStore } from '@/store/clinicStore'

// ─── helpers ────────────────────────────────────────────────────────────────

const AVATAR_COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#F97316','#EC4899']
function getAvatarColor(name: string) {
  let h = 0
  for (const c of name) h = c.charCodeAt(0) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

function calcAge(birthdate: string) {
  return differenceInYears(new Date(), parseISO(birthdate))
}


type Tab = 'visao-geral' | 'anamneses' | 'orcamentos' | 'tratamentos' | 'pagamentos' | 'evolucoes' | 'documentos'

const TABS: { id: Tab; label: string }[] = [
  { id: 'visao-geral',  label: 'Visão Geral' },
  { id: 'anamneses',    label: 'Anamneses' },
  { id: 'orcamentos',   label: 'Orçamentos' },
  { id: 'tratamentos',  label: 'Tratamentos' },
  { id: 'pagamentos',   label: 'Pagamentos' },
  { id: 'evolucoes',    label: 'Evoluções' },
  { id: 'documentos',   label: 'Documentos' },
]

const PAYMENT_METHOD_PT: Record<string, string> = {
  credit_card: 'Cartão de Crédito',
  health_plan: 'Convênio',
  bank_slip:   'Boleto',
  pix:         'PIX',
  cash:        'Dinheiro',
}

const GENDER_PT: Record<string, string> = { M: 'Masculino', F: 'Feminino', O: 'Outro' }

// ─── página ─────────────────────────────────────────────────────────────────

export default function PacienteDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const [patient, setPatient]         = useState<Patient | null>(null)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [payments, setPayments]       = useState<Payment[]>([])
  const [prosthetics, setProsthetics] = useState<Prosthetic[]>([])
  const [loading, setLoading]         = useState(true)
  const [activeTab, setActiveTab]     = useState<Tab>('visao-geral')
  const [tags, setTags]               = useState<string[]>([])
  const [clinicalNotes, setClinicalNotes] = useState('')
  const [modalCatOpen, setModalCatOpen] = useState(false)
  const [modalEditOpen, setModalEditOpen] = useState(false)
  const [treatRefresh, setTreatRefresh] = useState(0)
  const { clinicId } = useClinicStore()

  useEffect(() => {
    async function load() {
      const { id } = await params
      const supabase = createClient()
      const [patRes, aptsRes, paymentsRes, prostRes] = await Promise.all([
        supabase.from('patients').select('*, insurance_plan:insurance_plans(*)').eq('id', id).single(),
        supabase.from('appointments').select('*, professional:professionals(*)').eq('patient_id', id).order('start_time', { ascending: false }),
        supabase.from('payments').select('*').eq('patient_id', id).order('due_date', { ascending: false }),
        supabase.from('prosthetics').select('*, professional:professionals(*)').eq('patient_id', id),
      ])
      const p = patRes.data as Patient | null
      setPatient(p)
      setAppointments(aptsRes.data || [])
      setPayments(paymentsRes.data || [])
      setProsthetics(prostRes.data || [])
      if (p) {
        const parsed = parsePatientNotes(p.notes)
        setTags(parsed.tags)
        setClinicalNotes(parsed.notes)
      }
      setLoading(false)
    }
    load()
  }, [params])

  async function handleSaveTags(newTags: string[]) {
    if (!patient) return
    const supabase = createClient()
    const newNotes = serializePatientNotes(newTags, clinicalNotes)
    await supabase.from('patients').update({ notes: newNotes }).eq('id', patient.id)
    setTags(newTags)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)]">
        <div className="w-8 h-8 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!patient) {
    return <div className="p-6 text-[#6B7280]">Paciente não encontrado.</div>
  }

  const firstAppointment = appointments.length > 0
    ? appointments[appointments.length - 1]
    : null

  const lastEvolutions = appointments.filter((a) => a.status === 'completed').slice(0, 5)
  const patientCode = patient.id.replace(/-/g, '').slice(0, 6).toUpperCase()

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      {/* Header */}
      <div className="bg-white border-b border-[#E5E7EB]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="pt-4 pb-2">
            <Link href="/pacientes" className="inline-flex items-center gap-1 text-sm text-[#6B7280] hover:text-[#111827] mb-4">
              <ChevronLeft className="w-4 h-4" />
              Pacientes
            </Link>

            <div className="flex items-start gap-4">
              {/* Avatar */}
              <div
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center text-white text-lg font-bold shrink-0"
                style={{ backgroundColor: getAvatarColor(patient.name) }}
              >
                {getInitials(patient.name)}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold text-[#111827] uppercase tracking-wide">
                  {patient.name}
                </h1>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-[#6B7280]">
                  {patient.phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="w-3.5 h-3.5 text-[#25D366]" />
                      {formatPhone(patient.phone)}
                    </span>
                  )}
                  {firstAppointment && (
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      Primeiro atendimento:{' '}
                      {format(parseISO(firstAppointment.start_time), "dd/MM/yyyy", { locale: ptBR })}
                    </span>
                  )}
                </div>

                {/* Tags */}
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold text-white"
                      style={{ backgroundColor: CATEGORIA_COLORS[tag] || '#6B7280' }}
                    >
                      {tag}
                    </span>
                  ))}
                  <button
                    onClick={() => setModalCatOpen(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border border-dashed border-[#D1D5DB] text-[#6B7280] hover:border-[#3B82F6] hover:text-[#3B82F6] transition-colors"
                  >
                    <Tag className="w-3 h-3" />
                    Categorizar
                  </button>
                </div>
              </div>

              {/* Editar */}
              <button
                onClick={() => setModalEditOpen(true)}
                className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-lg border border-[#E5E7EB] text-sm font-medium text-[#374151] hover:bg-[#F3F4F6] transition-colors shrink-0">
                <Edit2 className="w-4 h-4" />
                Editar
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex overflow-x-auto -mb-px mt-3 gap-0 scrollbar-hide">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? 'border-[#3B82F6] text-[#3B82F6]'
                    : 'border-transparent text-[#6B7280] hover:text-[#111827]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Conteúdo das abas */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">

        {/* ── Visão Geral ─────────────────────────────────────────────────── */}
        {activeTab === 'visao-geral' && (
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Coluna esquerda */}
            <div className="lg:w-80 xl:w-96 shrink-0 space-y-4">

              {/* Card Tarefas */}
              <div className="bg-white rounded-xl border border-[#E5E7EB] p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <ClipboardList className="w-4 h-4 text-[#6B7280]" />
                    <span className="text-sm font-semibold text-[#111827]">Tarefas</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button className="p-1 rounded text-[#3B82F6] hover:bg-[#EFF6FF] text-xs font-medium flex items-center gap-1">
                      <Plus className="w-3 h-3" />
                      Nova
                    </button>
                    <ChevronLeft className="w-4 h-4 text-[#9CA3AF] rotate-180" />
                  </div>
                </div>
                <p className="text-xs text-[#9CA3AF]">Nenhuma tarefa cadastrada</p>
              </div>

              {/* Card Informações */}
              <div className="bg-white rounded-xl border border-[#E5E7EB] p-4">
                <h3 className="text-sm font-semibold text-[#111827] mb-4">Informações</h3>
                <div className="space-y-3">
                  <InfoRow label="Código do paciente" value={patientCode} />
                  <InfoRow
                    label="Preferência de lembretes"
                    value={patient.whatsapp ? 'WhatsApp' : patient.phone ? 'Telefone' : 'E-mail'}
                  />
                  {patient.phone && (
                    <InfoRow label="Celular" value={formatPhone(patient.phone)} />
                  )}
                  {patient.birthdate && (
                    <InfoRow
                      label="Data de nascimento"
                      value={`${format(parseISO(patient.birthdate), 'dd/MM/yyyy')} — ${calcAge(patient.birthdate)} anos`}
                    />
                  )}
                  {patient.gender && (
                    <InfoRow label="Gênero" value={GENDER_PT[patient.gender] || patient.gender} />
                  )}
                  <InfoRow
                    label="Convênio"
                    value={patient.insurance_plan?.name || 'Particular'}
                  />
                  {patient.cpf && (
                    <InfoRow label="CPF" value={patient.cpf} />
                  )}
                  {patient.email && (
                    <InfoRow label="E-mail" value={patient.email} />
                  )}
                  {clinicalNotes && (
                    <div>
                      <p className="text-xs text-[#9CA3AF] mb-0.5">Observações clínicas</p>
                      <p className="text-sm text-[#374151] whitespace-pre-wrap">{clinicalNotes}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Card Serasa */}
              <div className="bg-white rounded-xl border border-[#E5E7EB] p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-[#111827]">Consulta no Serasa</h3>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E5E7EB] text-xs font-medium text-[#374151] hover:bg-[#F3F4F6] transition-colors">
                    <ClipboardList className="w-3.5 h-3.5" />
                    Consultar
                  </button>
                </div>
                {/* Ilustração decorativa */}
                <div className="flex items-center justify-center py-4">
                  <svg width="80" height="60" viewBox="0 0 80 60" fill="none">
                    <circle cx="25" cy="30" r="20" fill="#EFF6FF" stroke="#BFDBFE" strokeWidth="1.5" />
                    <path d="M15 30 L25 20 L35 30 L25 40Z" fill="#3B82F6" opacity="0.6" />
                    <circle cx="25" cy="30" r="6" fill="#3B82F6" />
                    <rect x="52" y="15" width="24" height="30" rx="4" fill="#F0FDF4" stroke="#BBF7D0" strokeWidth="1.5" />
                    <text x="64" y="34" textAnchor="middle" fill="#16A34A" fontSize="14" fontWeight="bold">$</text>
                    <path d="M43 28 L48 28 M43 32 L48 32" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Coluna direita */}
            <div className="flex-1 min-w-0 space-y-4">

              {/* Card Odontograma */}
              <div className="bg-white rounded-xl border border-[#E5E7EB] p-4 sm:p-5">
                <h3 className="text-sm font-semibold text-[#111827] mb-4">Odontograma</h3>
                <Odontograma
                  patientId={patient.id}
                  clinicId={clinicId || ''}
                  refreshKey={treatRefresh}
                />
              </div>

              {/* Card Últimas Evoluções */}
              <div className="bg-white rounded-xl border border-[#E5E7EB] p-4 sm:p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-[#111827]">Últimas Evoluções</h3>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E5E7EB] text-xs font-medium text-[#374151] hover:bg-[#F3F4F6] transition-colors">
                    <Plus className="w-3.5 h-3.5" />
                    Adicionar
                  </button>
                </div>

                {lastEvolutions.length === 0 ? (
                  <p className="text-sm text-[#9CA3AF]">Nenhuma evolução registrada.</p>
                ) : (
                  <div className="space-y-3">
                    {lastEvolutions.map((apt) => (
                      <EvolutionCard key={apt.id} apt={apt} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Tratamentos ─────────────────────────────────────────────────── */}
        {activeTab === 'tratamentos' && clinicId && (
          <TabTratamentos
            patientId={patient.id}
            clinicId={clinicId}
            onTreatmentSaved={() => setTreatRefresh(v => v + 1)}
          />
        )}

        {/* ── Pagamentos ──────────────────────────────────────────────────── */}
        {activeTab === 'pagamentos' && (
          <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E5E7EB] flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#111827]">Pagamentos</h3>
              <span className="text-xs text-[#6B7280]">{payments.length} lançamento(s)</span>
            </div>
            {payments.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-sm text-[#9CA3AF]">
                Nenhum pagamento registrado.
              </div>
            ) : (
              <div className="divide-y divide-[#F3F4F6]">
                {payments.map((pay) => {
                  const statusConfig = {
                    paid:    { label: 'Pago',     color: '#10B981', icon: CheckCircle2 },
                    pending: { label: 'Pendente', color: '#F59E0B', icon: Clock },
                    overdue: { label: 'Atrasado', color: '#EF4444', icon: AlertCircle },
                  }[pay.status] || { label: pay.status, color: '#6B7280', icon: Clock }
                  const Icon = statusConfig.icon

                  return (
                    <div key={pay.id} className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3 hover:bg-[#F9FAFB] transition-colors">
                      <Icon className="w-4 h-4 shrink-0" style={{ color: statusConfig.color }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#111827] truncate">
                          {pay.description || 'Pagamento'}
                        </p>
                        <p className="text-xs text-[#6B7280]">
                          {pay.due_date && `Venc. ${format(parseISO(pay.due_date), 'dd/MM/yyyy')}`}
                          {pay.payment_method && ` · ${PAYMENT_METHOD_PT[pay.payment_method] || pay.payment_method}`}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold text-[#111827]">
                          {formatCurrency(pay.amount)}
                        </p>
                        <span
                          className="text-xs font-medium"
                          style={{ color: statusConfig.color }}
                        >
                          {statusConfig.label}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Totalizador */}
            {payments.length > 0 && (
              <div className="px-5 py-3 bg-[#F9FAFB] border-t border-[#E5E7EB] flex items-center justify-between">
                <span className="text-xs font-medium text-[#6B7280]">Total pago</span>
                <span className="text-sm font-bold text-[#10B981]">
                  {formatCurrency(payments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0))}
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── Evoluções ───────────────────────────────────────────────────── */}
        {activeTab === 'evolucoes' && (
          <div className="space-y-3">
            {appointments.filter(a => a.status === 'completed').length === 0 ? (
              <div className="bg-white rounded-xl border border-[#E5E7EB] flex items-center justify-center h-40 text-sm text-[#9CA3AF]">
                Nenhuma evolução registrada.
              </div>
            ) : (
              appointments.filter(a => a.status === 'completed').map((apt) => (
                <EvolutionCard key={apt.id} apt={apt} full />
              ))
            )}
          </div>
        )}

        {/* ── Anamneses ───────────────────────────────────────────────────── */}
        {activeTab === 'anamneses' && clinicId && (
          <TabAnamneses patientId={patient.id} clinicId={clinicId} />
        )}

        {/* ── Orçamentos ──────────────────────────────────────────────────── */}
        {activeTab === 'orcamentos' && clinicId && (
          <TabOrcamentos patientId={patient.id} clinicId={clinicId} />
        )}

        {/* ── Documentos ──────────────────────────────────────────────────── */}
        {activeTab === 'documentos' && clinicId && (
          <TabDocumentos patientId={patient.id} clinicId={clinicId} />
        )}
      </div>

      {/* Modal Categoria */}
      <ModalCategoria
        open={modalCatOpen}
        currentTags={tags}
        onClose={() => setModalCatOpen(false)}
        onSave={handleSaveTags}
      />

      {/* Modal Editar Paciente */}
      {modalEditOpen && (
        <ModalEditarPaciente
          open={modalEditOpen}
          patient={patient}
          onClose={() => setModalEditOpen(false)}
          onSaved={(updated) => { setPatient(updated); setModalEditOpen(false) }}
        />
      )}
    </div>
  )
}

// ─── sub-componentes ─────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-[#9CA3AF] mb-0.5">{label}</p>
      <p className="text-sm text-[#111827] font-medium">{value}</p>
    </div>
  )
}

function EvolutionCard({ apt, full = false }: { apt: Appointment; full?: boolean }) {
  const initials = apt.professional ? getInitials(apt.professional.name) : 'D'
  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-[#3B82F6] flex items-center justify-center text-white text-xs font-bold shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#111827] leading-snug">
            {apt.procedure || 'Consulta'} foi finalizado
          </p>
          <p className="text-xs text-[#6B7280] mt-0.5">
            {apt.professional?.name || 'Profissional'} ·{' '}
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {format(parseISO(apt.start_time), "d 'de' MMMM 'de' yyyy", { locale: ptBR })}
            </span>
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#EFF6FF] text-[#3B82F6] text-xs font-medium">
              {apt.procedure || 'Consulta'}
            </span>
            {apt.notes && full && (
              <p className="w-full text-xs text-[#6B7280] mt-1 italic">{apt.notes}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
