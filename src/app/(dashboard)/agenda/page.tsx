'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Plus, Users, SlidersHorizontal, X, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { format, addWeeks, subWeeks, addDays, subDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import { MiniCalendario } from '@/components/agenda/MiniCalendario'
import { CalendarioAgenda } from '@/components/agenda/CalendarioAgenda'
import { ModalNovaConsulta } from '@/components/agenda/ModalNovaConsulta'
import { PopoverConsulta } from '@/components/agenda/PopoverConsulta'
import { ModalEditarConsulta } from '@/components/agenda/ModalEditarConsulta'
import { ModalEvolucao } from '@/components/agenda/ModalEvolucao'
import type { Appointment, Professional, Patient, InsurancePlan } from '@/types'
import { cn } from '@/lib/utils'

export default function AgendaPage() {
  const { clinicId, loading: clinicLoading } = useClinicStore()
  const [view, setView] = useState<'timeGridWeek' | 'timeGridDay'>('timeGridWeek')

  // Auto-switch para dia em mobile
  useEffect(() => {
    function checkMobile() {
      if (window.innerWidth < 768) setView('timeGridDay')
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])
  const [currentDate, setCurrentDate] = useState(new Date())
  const [agendaState, setAgendaState] = useState<{ appointments: Appointment[]; version: number }>({ appointments: [], version: 0 })
  const appointments = agendaState.appointments
  const [professionals, setProfessionals] = useState<Professional[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [insurancePlans, setInsurancePlans] = useState<InsurancePlan[]>([])
  const [selectedProfessional, setSelectedProfessional] = useState<Professional | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalDate, setModalDate] = useState<Date | undefined>()
  const [modalHour, setModalHour] = useState<string | undefined>()
  const [waitingCount, setWaitingCount] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [popover, setPopover] = useState<{ apt: Appointment; rect: DOMRect } | null>(null)
  const [editingApt, setEditingApt] = useState<Appointment | null>(null)
  const [evolutionApt, setEvolutionApt] = useState<Appointment | null>(null)

  const [reloadKey, setReloadKey] = useState(0)

  const openPopover = useCallback((apt: Appointment, rect: DOMRect) => {
    setPopover({ apt, rect })
  }, [])

  const loadData = useCallback(async () => {
    if (!clinicId) return
    const supabase = createClient()

    const [profsRes, patientsRes, plansRes, aptsRes] = await Promise.all([
      supabase.from('professionals').select('*').eq('clinic_id', clinicId),
      supabase.from('patients').select('*, insurance_plan:insurance_plans(*)').eq('clinic_id', clinicId),
      supabase.from('insurance_plans').select('*').eq('clinic_id', clinicId).order('name'),
      supabase
        .from('appointments')
        .select('*, patient:patients(*, insurance_plan:insurance_plans(*)), professional:professionals(*)')
        .eq('clinic_id', clinicId),
    ])

    if (profsRes.data) setProfessionals(profsRes.data)
    if (patientsRes.data) setPatients(patientsRes.data)
    if (plansRes.data) setInsurancePlans(plansRes.data)
    if (aptsRes.error) console.error('[loadData] appointments error:', aptsRes.error)
    if (aptsRes.data) {
      setAgendaState(prev => ({ appointments: aptsRes.data!, version: prev.version + 1 }))
      setWaitingCount(aptsRes.data.filter((a) => a.status === 'waiting').length)
    }
  }, [clinicId])

  useEffect(() => {
    if (clinicId) loadData()
  }, [clinicId, reloadKey])

  function navigate(dir: 'prev' | 'next') {
    if (view === 'timeGridWeek') {
      setCurrentDate(dir === 'next' ? addWeeks(currentDate, 1) : subWeeks(currentDate, 1))
    } else {
      setCurrentDate(dir === 'next' ? addDays(currentDate, 1) : subDays(currentDate, 1))
    }
  }

  const filteredAppointments = useMemo(() =>
    selectedProfessional
      ? appointments.filter((a) => a.professional_id === selectedProfessional.id)
      : appointments,
    [appointments, selectedProfessional]
  )

  if (clinicLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)]">
        <div className="w-8 h-8 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const SidebarContent = () => (
    <>
      <MiniCalendario selectedDate={currentDate} onSelectDate={setCurrentDate} />
      <div className="border-t border-[#E5E7EB] p-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[#6B7280]" />
            <span className="text-sm font-medium text-[#111827]">Aguardando</span>
          </div>
          {waitingCount > 0 && (
            <span className="bg-[#F59E0B] text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {waitingCount}
            </span>
          )}
        </div>

        <div className="space-y-1 mb-3">
          <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-2">Profissionais</p>
          {/* Todos */}
          <button
            onClick={() => { setSelectedProfessional(null); setSidebarOpen(false) }}
            className={cn(
              'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors',
              selectedProfessional === null
                ? 'bg-[#EFF6FF] text-[#3B82F6] font-medium'
                : 'text-[#374151] hover:bg-[#F3F4F6]'
            )}
          >
            <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-[#E5E7EB]" />
            <span>Todos</span>
          </button>
          {professionals.length === 0 ? (
            <p className="text-xs text-[#9CA3AF] px-2">Nenhum profissional cadastrado</p>
          ) : (
            professionals.map((prof) => (
              <button
                key={prof.id}
                onClick={() => { setSelectedProfessional(prof); setSidebarOpen(false) }}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors',
                  selectedProfessional?.id === prof.id
                    ? 'bg-[#EFF6FF] text-[#3B82F6] font-medium'
                    : 'text-[#374151] hover:bg-[#F3F4F6]'
                )}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: prof.color }} />
                <span className="truncate">{prof.name}</span>
              </button>
            ))
          )}
        </div>

        <button className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm text-[#3B82F6] hover:bg-[#EFF6FF] transition-colors">
          <Plus className="w-3.5 h-3.5" />
          Adicionar profissional
        </button>
      </div>
    </>
  )

  return (
    <div className="flex h-[calc(100vh-56px-64px)] md:h-[calc(100vh-56px)]">
      {/* Sidebar — desktop */}
      <aside
        className="hidden md:flex flex-col bg-white border-r border-[#E5E7EB] shrink-0 overflow-hidden"
        style={{ width: sidebarCollapsed ? 0 : 256, transition: 'width 0.22s ease' }}
      >
        <div className="w-64 flex-1 overflow-y-auto flex flex-col">
          <SidebarContent />
        </div>
      </aside>

      {/* Sidebar drawer — mobile (sempre montado, desliza) */}
      <div
        className={cn(
          'fixed top-14 left-0 bottom-16 z-30 w-72 bg-white border-r border-[#E5E7EB] flex flex-col overflow-y-auto md:hidden shadow-xl transition-transform duration-300 ease-in-out',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex items-center justify-between p-3 border-b border-[#E5E7EB]">
          <span className="text-sm font-semibold text-[#111827]">Filtros</span>
          <button onClick={() => setSidebarOpen(false)} className="p-1 rounded text-[#6B7280] hover:bg-[#F3F4F6]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <SidebarContent />
      </div>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Conteúdo principal */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Toolbar */}
        <div className="bg-white border-b border-[#E5E7EB] px-3 py-2 flex items-center gap-2 flex-wrap">
          {/* Desktop sidebar toggle */}
          <button
            onClick={() => setSidebarCollapsed((v) => !v)}
            title={sidebarCollapsed ? 'Expandir painel' : 'Recolher painel'}
            className="hidden md:flex p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280] shrink-0 transition-colors"
          >
            {sidebarCollapsed
              ? <PanelLeftOpen className="w-4 h-4" />
              : <PanelLeftClose className="w-4 h-4" />}
          </button>

          {/* Mobile sidebar toggle */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280] shrink-0"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => navigate('prev')} className="p-2 md:p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280]">
              <ChevronLeft className="w-5 h-5 md:w-4 md:h-4" />
            </button>
            <button onClick={() => navigate('next')} className="p-2 md:p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280]">
              <ChevronRight className="w-5 h-5 md:w-4 md:h-4" />
            </button>
            <button
              onClick={() => setCurrentDate(new Date())}
              className="px-3 py-2 md:px-2.5 md:py-1.5 rounded-lg text-sm border border-[#E5E7EB] hover:bg-[#F3F4F6] text-[#374151]"
            >
              Hoje
            </button>
          </div>

          <h2 className="flex-1 text-sm font-semibold text-[#111827] capitalize truncate min-w-0">
            <span className="hidden sm:inline text-[#6B7280] font-normal mr-1">
              {selectedProfessional?.name && `${selectedProfessional.name} — `}
            </span>
            {format(currentDate, view === 'timeGridWeek' ? "MMM 'de' yyyy" : "EEE, d MMM", { locale: ptBR })}
          </h2>

          <div className="flex rounded-lg border border-[#E5E7EB] overflow-hidden shrink-0">
            <button
              onClick={() => setView('timeGridWeek')}
              className={cn('px-2.5 py-1.5 text-xs font-medium transition-colors',
                view === 'timeGridWeek' ? 'bg-[#3B82F6] text-white' : 'bg-white text-[#6B7280] hover:bg-[#F3F4F6]')}
            >
              Semana
            </button>
            <button
              onClick={() => setView('timeGridDay')}
              className={cn('px-2.5 py-1.5 text-xs font-medium transition-colors border-l border-[#E5E7EB]',
                view === 'timeGridDay' ? 'bg-[#3B82F6] text-white' : 'bg-white text-[#6B7280] hover:bg-[#F3F4F6]')}
            >
              Dia
            </button>
          </div>

          <button
            onClick={() => { setModalDate(new Date()); setModalOpen(true) }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#3B82F6] text-white rounded-lg text-xs font-medium hover:bg-[#2563EB] transition-colors shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Nova consulta</span>
            <span className="sm:hidden">Nova</span>
          </button>
        </div>

        <div className="flex-1 overflow-hidden bg-white">
          <CalendarioAgenda
            key={agendaState.version}
            view={view}
            currentDate={currentDate}
            appointments={filteredAppointments}
            onDateClick={(date, hour) => { setModalDate(date); setModalHour(hour); setModalOpen(true) }}
            onEventClick={openPopover}
          />
        </div>
      </div>

      {clinicId && (
        <ModalNovaConsulta
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setReloadKey((k) => k + 1) }}
          initialDate={modalDate}
          initialHour={modalHour}
          initialProfessionalId={selectedProfessional?.id}
          clinicId={clinicId}
          professionals={professionals}
          patients={patients}
          insurancePlans={insurancePlans}
        />
      )}

      {popover && (
        <PopoverConsulta
          appointment={popover.apt}
          anchorRect={popover.rect}
          onClose={() => setPopover(null)}
          onEdit={() => { setPopover(null); setEditingApt(popover.apt) }}
          onAddEvolucao={() => { setPopover(null); setEvolutionApt(popover.apt) }}
          onConfirmed={() => setReloadKey(k => k + 1)}
        />
      )}

      {editingApt && (
        <ModalEditarConsulta
          open={true}
          appointment={editingApt}
          professionals={professionals}
          onClose={() => setEditingApt(null)}
          onSaved={() => { setEditingApt(null); setReloadKey((k) => k + 1) }}
        />
      )}

      {evolutionApt && clinicId && (
        <ModalEvolucao
          open={true}
          appointment={evolutionApt}
          professionals={professionals}
          clinicId={clinicId}
          onClose={() => setEvolutionApt(null)}
          onSaved={() => setEvolutionApt(null)}
        />
      )}
    </div>
  )
}
