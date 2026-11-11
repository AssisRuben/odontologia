'use client'

import { formatCpf } from '@/lib/payments/cpf'
import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  ChevronLeft, Phone, Edit2, Tag, Plus,
  Calendar, Clock, User2, MessageCircle,
} from 'lucide-react'
import { format, parseISO, differenceInYears } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'
import { getInitials, formatPhone, formatCurrency } from '@/lib/utils'
import {
  parsePatientNotes, serializePatientNotes,
} from '@/types'
import type { Patient, Appointment, Payment, FiscalInvoice } from '@/types'
import { Odontograma } from '@/components/paciente/Odontograma'
import { ModalCategoria, CATEGORIA_COLORS } from '@/components/paciente/ModalCategoria'
import { ModalEditarPaciente } from '@/components/paciente/ModalEditarPaciente'
import { TabAnamneses } from '@/components/paciente/TabAnamneses'
import { TabOrcamentos } from '@/components/paciente/TabOrcamentos'
import { TabDocumentos } from '@/components/paciente/TabDocumentos'
import { TabTratamentos } from '@/components/paciente/TabTratamentos'
import { TabProteses } from '@/components/paciente/TabProteses'
import { useClinicStore } from '@/store/clinicStore'
import { ModalEnviarWhatsApp } from '@/components/mensagens/ModalEnviarWhatsApp'
import ListaPagamentos from '@/components/pagamentos/ListaPagamentos'
import { ModalNovaCobranca } from '@/components/pagamentos/ModalNovaCobranca'
import { normalizePhone } from '@/lib/messaging/phone'

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


type Tab = 'visao-geral' | 'anamneses' | 'orcamentos' | 'tratamentos' | 'proteses' | 'pagamentos' | 'evolucoes' | 'documentos'

const TABS: { id: Tab; label: string }[] = [
  { id: 'visao-geral',  label: 'Visão Geral' },
  { id: 'anamneses',    label: 'Anamneses' },
  { id: 'orcamentos',   label: 'Orçamentos' },
  { id: 'tratamentos',  label: 'Tratamentos' },
  { id: 'proteses',     label: 'Próteses' },
  { id: 'pagamentos',   label: 'Pagamentos' },
  { id: 'evolucoes',    label: 'Evoluções' },
  { id: 'documentos',   label: 'Documentos' },
]

interface PatientEvolution {
  id: string
  date: string
  description: string
  images: string[] | null
  ai_used: boolean
  professional?: { name: string; color: string | null } | null
}

const GENDER_PT: Record<string, string> = { M: 'Masculino', F: 'Feminino', O: 'Outro' }

// ─── página ─────────────────────────────────────────────────────────────────

export default function PacienteDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-[calc(100vh-56px)]">
          <div className="w-8 h-8 border-2 border-petroleo border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <PacienteDetalhe params={params} />
    </Suspense>
  )
}

function PacienteDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const searchParams = useSearchParams()
  const [patient, setPatient]         = useState<Patient | null>(null)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [evolutions, setEvolutions]   = useState<PatientEvolution[]>([])
  const [payments, setPayments]       = useState<Payment[]>([])
  const [invoices, setInvoices]       = useState<FiscalInvoice[]>([])
  const [loading, setLoading]         = useState(true)
  const [activeTab, setActiveTab]     = useState<Tab>(() => {
    const aba = searchParams.get('aba')
    return TABS.some(t => t.id === aba) ? (aba as Tab) : 'visao-geral'
  })
  const [tags, setTags]               = useState<string[]>([])
  const [clinicalNotes, setClinicalNotes] = useState('')
  const [modalCatOpen, setModalCatOpen] = useState(false)
  const [modalEditOpen, setModalEditOpen] = useState(false)
  const [modalWaOpen, setModalWaOpen] = useState(false)
  const [waNotice, setWaNotice]       = useState(false)
  const [modalCobrancaOpen, setModalCobrancaOpen] = useState(false)
  const [treatRefresh, setTreatRefresh] = useState(0)
  const { clinicId } = useClinicStore()

  useEffect(() => {
    async function load() {
      const { id } = await params
      const supabase = createClient()
      const [patRes, aptsRes, paymentsRes, evoRes] = await Promise.all([
        supabase.from('patients').select('*, insurance_plan:insurance_plans(*)').eq('id', id).single(),
        supabase.from('appointments').select('*, professional:professionals(*)').eq('patient_id', id).order('start_time', { ascending: false }),
        supabase.from('payments').select('*').eq('patient_id', id).order('due_date', { ascending: false }),
        supabase.from('evolutions')
          .select('id, date, description, images, ai_used, professional:professionals(name, color)')
          .eq('patient_id', id)
          .order('date', { ascending: false })
          .order('created_at', { ascending: false }),
      ])
      const p = patRes.data as Patient | null
      setPatient(p)
      setAppointments(aptsRes.data || [])
      setPayments(paymentsRes.data || [])
      if (paymentsRes.data?.length) {
        const { data: inv } = await supabase.from('fiscal_invoices').select('*').in('payment_id', paymentsRes.data.map((x: Payment) => x.id))
        setInvoices((inv as FiscalInvoice[]) || [])
      }
      setEvolutions((evoRes.data as unknown as PatientEvolution[]) || [])
      if (p) {
        const parsed = parsePatientNotes(p.notes)
        setTags(parsed.tags)
        setClinicalNotes(parsed.notes)
      }
      setLoading(false)
    }
    load()
  }, [params])

  async function loadInvoices(list: Payment[]) {
    if (list.length === 0) { setInvoices([]); return }
    const { data } = await createClient().from('fiscal_invoices').select('*').in('payment_id', list.map(p => p.id))
    setInvoices((data as FiscalInvoice[]) || [])
  }

  async function reloadPayments() {
    if (!patient) return
    const supabase = createClient()
    const { data } = await supabase.from('payments').select('*').eq('patient_id', patient.id).order('due_date', { ascending: false })
    setPayments(data || [])
    await loadInvoices(data || [])
  }

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
        <div className="w-8 h-8 border-2 border-petroleo border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!patient) {
    return <div className="p-6 text-tinta-3">Paciente não encontrado.</div>
  }

  const firstAppointment = appointments.length > 0
    ? appointments[appointments.length - 1]
    : null

  const lastEvolutions = evolutions.slice(0, 5)
  const waDisabledHint = patient.whatsapp_opt_out
    ? 'Paciente optou por não receber WhatsApp'
    : (normalizePhone(patient.whatsapp ?? null) ?? normalizePhone(patient.phone ?? null)) ? null : 'Sem WhatsApp válido'
  const patientCode = patient.id.replace(/-/g, '').slice(0, 6).toUpperCase()

  return (
    <div className="min-h-screen bg-porcelana">
      {/* Header */}
      <div className="border-b border-linha">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="pt-4 pb-2">
            <Link href="/pacientes" className="inline-flex items-center gap-1 text-sm text-tinta-3 hover:text-tinta mb-4">
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
                <h1 className="text-xl sm:text-2xl font-bold text-tinta uppercase tracking-wide">
                  {patient.name}
                </h1>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-tinta-3">
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

                {patient.source === 'whatsapp' && !patient.cpf && (
                  <p className="mt-2 inline-flex items-center rounded-md bg-[#FEF3C7] px-2.5 py-1 text-xs font-medium text-[#92400E]">
                    Cadastrado pelo WhatsApp — complete CPF e dados no atendimento
                  </p>
                )}

                {/* Tags */}
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold text-white"
                      style={{ backgroundColor: CATEGORIA_COLORS[tag] || '#5E6E75' }}
                    >
                      {tag}
                    </span>
                  ))}
                  <button
                    onClick={() => setModalCatOpen(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border border-dashed border-linha-forte text-tinta-3 hover:border-petroleo hover:text-petroleo transition-colors"
                  >
                    <Tag className="w-3 h-3" />
                    Categorizar
                  </button>
                </div>
              </div>

              {/* Ações */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setModalWaOpen(true)}
                  disabled={!!waDisabledHint}
                  title={waDisabledHint ?? undefined}
                  className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg border border-linha text-sm font-medium text-tinta-2 hover:bg-porcelana transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent">
                  <MessageCircle className="w-4 h-4 text-[#25D366]" />
                  <span className="hidden sm:inline">Enviar WhatsApp</span>
                </button>
                <button
                  onClick={() => setModalEditOpen(true)}
                  className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-lg border border-linha text-sm font-medium text-tinta-2 hover:bg-porcelana transition-colors">
                  <Edit2 className="w-4 h-4" />
                  Editar
                </button>
              </div>
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
                    ? 'border-petroleo text-petroleo'
                    : 'border-transparent text-tinta-3 hover:text-tinta'
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

              {/* Card Informações */}
              <div className="bg-white rounded-xl border border-linha p-4">
                <h3 className="text-sm font-semibold text-tinta mb-4">Informações</h3>
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
                  {(patient.payer_name || patient.payer_cpf) && (
                    <InfoRow
                      label="Responsável pelo pagamento"
                      value={[patient.payer_name, patient.payer_cpf ? formatCpf(patient.payer_cpf) : null].filter(Boolean).join(' · ')}
                    />
                  )}
                  {patient.email && (
                    <InfoRow label="E-mail" value={patient.email} />
                  )}
                  {clinicalNotes && (
                    <div>
                      <p className="text-xs text-tinta-4 mb-0.5">Observações clínicas</p>
                      <p className="text-sm text-tinta-2 whitespace-pre-wrap">{clinicalNotes}</p>
                    </div>
                  )}
                </div>
              </div>

            </div>

            {/* Coluna direita */}
            <div className="flex-1 min-w-0 space-y-4">

              {/* Card Odontograma */}
              <div className="bg-white rounded-xl border border-linha p-4 sm:p-5">
                <h3 className="text-sm font-semibold text-tinta mb-4">Odontograma</h3>
                <Odontograma
                  patientId={patient.id}
                  clinicId={clinicId || ''}
                  refreshKey={treatRefresh}
                />
              </div>

              {/* Card Últimas Evoluções */}
              <div className="bg-white rounded-xl border border-linha p-4 sm:p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-tinta">Últimas Evoluções</h3>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-linha text-xs font-medium text-tinta-2 hover:bg-porcelana transition-colors">
                    <Plus className="w-3.5 h-3.5" />
                    Adicionar
                  </button>
                </div>

                {lastEvolutions.length === 0 ? (
                  <p className="text-sm text-tinta-4">Nenhuma evolução registrada.</p>
                ) : (
                  <div className="space-y-3">
                    {lastEvolutions.map((ev) => (
                      <EvolutionCard key={ev.id} ev={ev} />
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

        {/* ── Próteses ────────────────────────────────────────────────────── */}
        {activeTab === 'proteses' && clinicId && (
          <TabProteses patient={{ id: patient.id, name: patient.name }} />
        )}

        {/* ── Pagamentos ──────────────────────────────────────────────────── */}
        {activeTab === 'pagamentos' && (
          <div className="bg-white rounded-xl border border-linha overflow-hidden">
            <div className="px-5 py-4 border-b border-linha flex items-center justify-between">
              <h3 className="text-sm font-semibold text-tinta">Pagamentos</h3>
              <div className="flex items-center gap-3">
                <span className="text-xs text-tinta-3">{payments.length} lançamento(s)</span>
                <button onClick={() => setModalCobrancaOpen(true)}
                  className="flex items-center gap-1.5 px-3 h-8 bg-petroleo text-white text-xs font-medium rounded-lg hover:bg-petroleo-escuro transition-colors">
                  <Plus className="w-3.5 h-3.5" /> Nova cobrança
                </button>
              </div>
            </div>
            <ListaPagamentos payments={payments} invoices={invoices} onChanged={reloadPayments} />

            {/* Totalizador */}
            {payments.length > 0 && (
              <div className="px-5 py-3 bg-porcelana-2 border-t border-linha flex items-center justify-between">
                <span className="text-xs font-medium text-tinta-3">Total pago</span>
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
            {evolutions.length === 0 ? (
              <div className="bg-white rounded-xl border border-linha flex items-center justify-center h-40 text-sm text-tinta-4">
                Nenhuma evolução registrada.
              </div>
            ) : (
              evolutions.map((ev) => (
                <EvolutionCard key={ev.id} ev={ev} full />
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
          <TabOrcamentos patientId={patient.id} clinicId={clinicId} patient={patient} />
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

      {waNotice && (
        <div role="status" className="fixed bottom-4 right-4 z-50 bg-tinta text-white text-sm px-4 py-2 rounded-lg shadow-lg">
          Mensagem enviada
        </div>
      )}

      {modalWaOpen && (
        <ModalEnviarWhatsApp
          patient={patient}
          appointments={appointments}
          onClose={() => setModalWaOpen(false)}
          onSent={() => { setWaNotice(true); setTimeout(() => setWaNotice(false), 4000) }}
        />
      )}

      {modalCobrancaOpen && (
        <ModalNovaCobranca
          patient={patient}
          onClose={() => setModalCobrancaOpen(false)}
          onCreated={reloadPayments}
        />
      )}

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
      <p className="text-xs text-tinta-4 mb-0.5">{label}</p>
      <p className="text-sm text-tinta font-medium">{value}</p>
    </div>
  )
}

function EvolutionCard({ ev, full = false }: { ev: PatientEvolution; full?: boolean }) {
  const name = ev.professional?.name || 'Profissional'
  const initials = ev.professional ? getInitials(ev.professional.name) : 'D'
  const fotos = (ev.images ?? []).filter((u) => /^https?:\/\//.test(u))
  return (
    <div className="bg-white rounded-xl border border-linha p-4">
      <div className="flex items-start gap-3">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
          style={{ backgroundColor: ev.professional?.color || '#173B47' }}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs text-tinta-3">
              {name} ·{' '}
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {format(parseISO(ev.date), "d 'de' MMMM 'de' yyyy", { locale: ptBR })}
              </span>
            </p>
            {ev.ai_used && (
              <span className="px-1.5 py-0.5 rounded-full bg-[#F5F3FF] text-[#7C3AED] text-[10px] font-semibold">
                IA
              </span>
            )}
          </div>
          <p className={`mt-1.5 text-sm text-tinta leading-relaxed whitespace-pre-line ${full ? '' : 'line-clamp-3'}`}>
            {ev.description}
          </p>
          {full && fotos.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {fotos.map((url) => (
                <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="Foto da evolução" className="w-20 h-20 object-cover rounded-lg border border-linha" />
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
