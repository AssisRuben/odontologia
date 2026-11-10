'use client'

import { Suspense, useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, Plus, SlidersHorizontal, X, PanelRightClose, PanelRightOpen, MessageCircleOff } from 'lucide-react'
import { format, addWeeks, subWeeks, addDays, subDays, startOfWeek, startOfDay } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import { MiniCalendario } from '@/components/agenda/MiniCalendario'
import { CalendarioAgenda } from '@/components/agenda/CalendarioAgenda'
import { ModalNovaConsulta } from '@/components/agenda/ModalNovaConsulta'
import { PopoverConsulta } from '@/components/agenda/PopoverConsulta'
import { ModalEditarConsulta } from '@/components/agenda/ModalEditarConsulta'
import { ModalEvolucao } from '@/components/agenda/ModalEvolucao'
import { useWhatsAppStatus, formatNoticeTime } from '@/components/agenda/useWhatsAppStatus'
import { aConfirmarHoje, aguardandoHoje } from '@/lib/agenda/aguardando'
import { formatHora, todayYmd } from '@/lib/messaging/time'
import type { Appointment, Professional, Patient, InsurancePlan } from '@/types'
import { cn } from '@/lib/utils'

function dataInicial(raw: string | null): Date {
  const m = raw ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw) : null
  if (!m) return new Date()
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.getMonth() !== Number(m[2]) - 1 ? new Date() : d
}

export default function AgendaPage() {
  return (
    <Suspense fallback={null}>
      <AgendaConteudo />
    </Suspense>
  )
}

function AgendaConteudo() {
  const searchParams = useSearchParams()
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
  const [currentDate, setCurrentDate] = useState(() => dataInicial(searchParams.get('data')))
  const [agendaState, setAgendaState] = useState<{ appointments: Appointment[]; version: number }>({ appointments: [], version: 0 })
  const appointments = agendaState.appointments
  const [professionals, setProfessionals] = useState<Professional[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [insurancePlans, setInsurancePlans] = useState<InsurancePlan[]>([])
  const [selectedProfessional, setSelectedProfessional] = useState<Professional | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalDate, setModalDate] = useState<Date | undefined>()
  const [modalHour, setModalHour] = useState<string | undefined>()
  const [modalPatientId, setModalPatientId] = useState<string | undefined>()
  const [modalProfessionalId, setModalProfessionalId] = useState<string | undefined>()
  const [modalNotes, setModalNotes] = useState<string | undefined>()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [popover, setPopover] = useState<{ apt: Appointment; rect: DOMRect } | null>(null)
  const [editingApt, setEditingApt] = useState<Appointment | null>(null)
  function abrirNovaConsulta(o: { date?: Date; hour?: string; patientId?: string; professionalId?: string; notes?: string } = {}) {
    setModalDate(o.date)
    setModalHour(o.hour)
    setModalPatientId(o.patientId)
    setModalProfessionalId(o.professionalId)
    setModalNotes(o.notes)
    setModalOpen(true)
  }

  const [evolutionApt, setEvolutionApt] = useState<Appointment | null>(null)

  const [reloadKey, setReloadKey] = useState(0)
  const [dismissedNoticeKey, setDismissedNoticeKey] = useState('')

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

  // Consultas do intervalo exibido (semana ou dia) — base dos indicadores do WhatsApp
  const visibleAppointments = useMemo(() => {
    const from = view === 'timeGridWeek' ? startOfWeek(currentDate) : startOfDay(currentDate)
    const to = addDays(from, view === 'timeGridWeek' ? 7 : 1)
    return filteredAppointments.filter((a) => {
      const t = new Date(a.start_time)
      return t >= from && t < to
    })
  }, [filteredAppointments, view, currentDate])
  const { indicators, cancelNotices, tz: clinicTz } = useWhatsAppStatus(visibleAppointments, appointments)

  // Sala de espera: só hoje e do profissional selecionado.
  const agora = new Date()
  const hojeYmd = todayYmd(agora, clinicTz)
  const waitingToday = aguardandoHoje(appointments, hojeYmd, clinicTz, selectedProfessional?.id)
  // Falta confirmar: consultas de hoje ainda "Agendadas" e que não passaram.
  const aConfirmar = aConfirmarHoje(appointments, hojeYmd, clinicTz, agora, selectedProfessional?.id)

  const noticeKey = cancelNotices.map((n) => n.appointment.id).join(',')

  function openNoticeAppointment(apt: Appointment, el: HTMLElement) {
    setCurrentDate(new Date(apt.start_time))
    openPopover(apt, el.getBoundingClientRect())
  }

  if (clinicLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)]">
        <div className="w-8 h-8 border-2 border-petroleo border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Cabeçalho: na semana mostra o intervalo (seg a sáb); no dia, o dia por extenso.
  const semanaInicio = addDays(startOfWeek(currentDate), 1)
  const semanaFim = addDays(semanaInicio, 5)
  const titulo = view === 'timeGridWeek'
    ? semanaInicio.getMonth() === semanaFim.getMonth()
      ? `${format(semanaInicio, 'd')} a ${format(semanaFim, "d 'de' MMMM", { locale: ptBR })}`
      : `${format(semanaInicio, "d 'de' MMM", { locale: ptBR })} a ${format(semanaFim, "d 'de' MMM", { locale: ptBR })}`
    : capitalizar(format(currentDate, "EEEE, d 'de' MMMM", { locale: ptBR }))
  // No celular o dia da semana completo não cabe: "Ter., 10 de novembro".
  const tituloCurto = view === 'timeGridWeek'
    ? titulo
    : capitalizar(format(currentDate, "EEE, d 'de' MMMM", { locale: ptBR }))
  const subtitulo = selectedProfessional ? selectedProfessional.name : 'Todos os profissionais'

  const chipClasse = (ativo: boolean) => cn(
    'inline-flex items-center gap-1.5 h-8 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors',
    ativo ? 'bg-tinta text-white' : 'bg-white text-tinta-3 ring-1 ring-inset ring-linha hover:text-tinta',
  )

  const renderPainel = (celular: boolean) => (
    <div className="space-y-3">
      {/* Sala de espera */}
      <section className="bg-white rounded-xl ring-1 ring-linha p-4">
        <h3 className="font-display text-base font-semibold text-tinta flex items-center gap-2">
          Sala de espera
          {waitingToday.length > 0 && (
            <span className="font-sans text-xs font-semibold rounded-full px-2 py-px bg-[#ECE7FA] text-[#43348A] tabular-nums">
              {waitingToday.length}
            </span>
          )}
        </h3>
        <p className="text-[13px] text-tinta-4 mb-1">Chegaram e aguardam atendimento</p>
        {waitingToday.length === 0 ? (
          <p className="text-sm text-tinta-3 pt-1">Ninguém aguardando agora.</p>
        ) : (
          <ul>
            {waitingToday.map((apt) => (
              <PainelLinha
                key={apt.id}
                apt={apt}
                cor={{ bg: '#ECE7FA', fg: '#43348A' }}
                detalhe={`${formatHora(new Date(apt.start_time), clinicTz)}${!selectedProfessional && apt.professional?.name ? `, com ${primeiroNome(apt.professional.name)}` : ''}`}
                onClick={(el) => { setSidebarOpen(false); openNoticeAppointment(apt, el) }}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Falta confirmar */}
      <section className="bg-white rounded-xl ring-1 ring-linha p-4">
        <h3 className="font-display text-base font-semibold text-tinta flex items-center gap-2">
          Falta confirmar
          {aConfirmar.length > 0 && (
            <span className="font-sans text-xs font-semibold rounded-full px-2 py-px bg-[#FFF5E1] text-[#6A4A0C] tabular-nums">
              {aConfirmar.length}
            </span>
          )}
        </h3>
        <p className="text-[13px] text-tinta-4 mb-1">Consultas de hoje ainda como &quot;Agendado&quot;</p>
        {aConfirmar.length === 0 ? (
          <p className="text-sm text-tinta-3 pt-1">Tudo confirmado para hoje.</p>
        ) : (
          <ul>
            {aConfirmar.map((apt) => (
              <PainelLinha
                key={apt.id}
                apt={apt}
                cor={{ bg: '#FFF5E1', fg: '#6A4A0C' }}
                detalhe={`${formatHora(new Date(apt.start_time), clinicTz)}${apt.procedure ? `, ${apt.procedure}` : ''}`}
                onClick={(el) => { setSidebarOpen(false); openNoticeAppointment(apt, el) }}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Profissionais — só na gaveta do celular (no computador ficam nos chips) */}
      {celular && (
        <section className="bg-white rounded-xl ring-1 ring-linha p-4">
          <h3 className="font-display text-base font-semibold text-tinta mb-2">Profissionais</h3>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => { setSelectedProfessional(null); setSidebarOpen(false) }}
              className={cn(chipClasse(selectedProfessional === null), 'px-3')}
            >
              Todos
            </button>
            {professionals.map((prof) => (
              <button
                key={prof.id}
                onClick={() => { setSelectedProfessional(prof); setSidebarOpen(false) }}
                className={cn(chipClasse(selectedProfessional?.id === prof.id), 'pl-1 pr-3')}
              >
                <IniciaisProf prof={prof} />
                {primeiroNome(prof.name)}
              </button>
            ))}
          </div>
          {professionals.length === 0 && (
            <Link href="/configuracoes/profissionais" className="text-sm text-petroleo font-medium hover:underline">
              Cadastrar profissional
            </Link>
          )}
        </section>
      )}

      <section className="bg-white rounded-xl ring-1 ring-linha overflow-hidden">
        <MiniCalendario selectedDate={currentDate} onSelectDate={(d) => { setCurrentDate(d); setSidebarOpen(false) }} />
      </section>
    </div>
  )

  return (
    <div className="flex h-[calc(100vh-56px-64px)] md:h-[calc(100vh-56px)]">
      {/* Conteúdo principal */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Cabeçalho */}
        <div className="px-3 md:px-6 pt-3 md:pt-5 pb-3 space-y-3">
          <div className="flex items-center gap-2 md:gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-[22px] md:text-[26px] font-semibold text-tinta leading-tight truncate">
                <span className="sm:hidden">{tituloCurto}</span>
                <span className="hidden sm:inline">{titulo}</span>
              </h1>
              <p className="text-sm text-tinta-3 truncate">{subtitulo}</p>
            </div>

            {/* Celular: abre o painel (sala de espera, confirmar, profissionais, calendário) */}
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Abrir painel do dia"
              className="md:hidden relative w-10 h-10 grid place-items-center rounded-[10px] bg-white ring-1 ring-inset ring-linha text-tinta-3 shrink-0"
            >
              <SlidersHorizontal className="w-4 h-4" />
              {waitingToday.length + aConfirmar.length > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-gengiva ring-2 ring-white" />
              )}
            </button>

            {/* Computador: mostra/esconde o painel da direita */}
            <button
              onClick={() => setSidebarCollapsed((v) => !v)}
              title={sidebarCollapsed ? 'Mostrar painel do dia' : 'Esconder painel do dia'}
              aria-label={sidebarCollapsed ? 'Mostrar painel do dia' : 'Esconder painel do dia'}
              className="hidden md:grid w-10 h-10 place-items-center rounded-[10px] bg-white ring-1 ring-inset ring-linha text-tinta-3 hover:text-tinta shrink-0 transition-colors"
            >
              {sidebarCollapsed ? <PanelRightOpen className="w-4 h-4" /> : <PanelRightClose className="w-4 h-4" />}
            </button>

            <button
              onClick={() => abrirNovaConsulta({ date: new Date() })}
              className="flex items-center gap-1.5 h-10 px-3 md:px-4 bg-petroleo text-white rounded-[10px] text-sm font-semibold hover:bg-petroleo-escuro transition-colors shrink-0"
            >
              <Plus className="w-4 h-4" strokeWidth={2.4} />
              <span className="hidden sm:inline">Nova consulta</span>
              <span className="sm:hidden">Nova</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {/* ‹ Hoje › */}
            <div className="flex items-center h-9 bg-white rounded-[10px] ring-1 ring-inset ring-linha shrink-0">
              <button onClick={() => navigate('prev')} aria-label="Anterior" className="h-full px-2.5 text-tinta-3 hover:text-tinta">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setCurrentDate(new Date())}
                className="h-full px-3 text-sm font-semibold text-tinta border-x border-linha"
              >
                Hoje
              </button>
              <button onClick={() => navigate('next')} aria-label="Próximo" className="h-full px-2.5 text-tinta-3 hover:text-tinta">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Semana / Dia */}
            <div className="flex h-9 p-[3px] rounded-[10px] bg-[#DFE6E7] shrink-0" role="group" aria-label="Visualização">
              {([['timeGridWeek', 'Semana'], ['timeGridDay', 'Dia']] as const).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={cn(
                    'px-3 rounded-[7px] text-[13px] transition-colors',
                    view === v ? 'bg-white text-tinta font-semibold shadow-[0_1px_2px_rgba(23,59,71,0.13)]' : 'text-tinta-3 font-medium hover:text-tinta',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Profissionais — computador */}
            <div className="hidden md:flex items-center gap-1.5 ml-1 min-w-0 overflow-x-auto">
              <button onClick={() => setSelectedProfessional(null)} aria-pressed={selectedProfessional === null} className={cn(chipClasse(selectedProfessional === null), 'px-3')}>
                Todos
              </button>
              {professionals.map((prof) => (
                <button
                  key={prof.id}
                  onClick={() => setSelectedProfessional(prof)}
                  aria-pressed={selectedProfessional?.id === prof.id}
                  title={prof.name}
                  className={cn(chipClasse(selectedProfessional?.id === prof.id), 'pl-1 pr-3')}
                >
                  <IniciaisProf prof={prof} />
                  {primeiroNome(prof.name)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {cancelNotices.length > 0 && noticeKey !== dismissedNoticeKey && (
          <div role="status" className="mx-3 md:mx-6 mb-3 rounded-xl bg-[#FEF3C7] ring-1 ring-[#FDE68A] px-3 py-2 flex items-start gap-2 text-sm text-[#92400E]">
            <MessageCircleOff className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold">
                {cancelNotices.length} paciente(s) desmarcaram pelo WhatsApp
              </p>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {cancelNotices.map(({ appointment }) => (
                  <li key={appointment.id}>
                    <button
                      onClick={(e) => openNoticeAppointment(appointment, e.currentTarget)}
                      className="underline underline-offset-2 hover:text-[#78350F] text-left"
                    >
                      {appointment.patient?.name || 'Paciente'}, {formatNoticeTime(appointment.start_time, clinicTz)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <button
              onClick={() => setDismissedNoticeKey(noticeKey)}
              title="Dispensar aviso"
              className="p-1 rounded-md hover:bg-[#FDE68A] shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0 mx-2 md:mx-6 mb-2 md:mb-5 bg-white rounded-xl ring-1 ring-linha overflow-hidden">
          <CalendarioAgenda
            key={agendaState.version}
            view={view}
            currentDate={currentDate}
            appointments={filteredAppointments}
            indicators={indicators}
            onDateClick={(date, hour) => abrirNovaConsulta({ date, hour })}
            onEventClick={openPopover}
          />
        </div>
      </div>

      {/* Painel do dia — computador */}
      <aside
        className="hidden md:block shrink-0 overflow-y-auto overflow-x-hidden"
        style={{ width: sidebarCollapsed ? 0 : 314, transition: 'width 0.22s ease' }}
        aria-label="Painel do dia"
      >
        <div className="w-[314px] pr-6 pt-5 pb-5">
          {renderPainel(false)}
        </div>
      </aside>

      {/* Painel do dia — celular (gaveta pela direita) */}
      <div
        className={cn(
          'fixed top-14 right-0 bottom-16 z-30 w-80 max-w-[88vw] bg-porcelana border-l border-linha flex flex-col overflow-y-auto md:hidden shadow-xl transition-transform duration-300 ease-in-out',
          sidebarOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <span className="font-display text-lg font-semibold text-tinta">Hoje</span>
          <button onClick={() => setSidebarOpen(false)} aria-label="Fechar painel" className="p-1.5 rounded-md text-tinta-3 hover:bg-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-3 pb-4">{renderPainel(true)}</div>
      </div>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-tinta/30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {clinicId && (
        <ModalNovaConsulta
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setReloadKey((k) => k + 1) }}
          initialDate={modalDate}
          initialHour={modalHour}
          initialProfessionalId={modalProfessionalId ?? selectedProfessional?.id}
          initialPatientId={modalPatientId}
          initialNotes={modalNotes}
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
          whatsapp={indicators.get(popover.apt.id)}
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
          onSaved={(retorno) => {
            const apt = evolutionApt
            setEvolutionApt(null)
            if (retorno) {
              const [y, m, d] = retorno.data.split('-').map(Number)
              abrirNovaConsulta({
                date: new Date(y, m - 1, d),
                patientId: apt.patient_id,
                professionalId: retorno.professionalId,
                notes: `Retorno: ${retorno.motivo}`,
              })
            }
          }}
        />
      )}
    </div>
  )
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/** "Dra. Helena Prado" → "Helena" (sem o título). */
function primeiroNome(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter((p) => !/^dra?\.?$/i.test(p))
  return partes[0] ?? nome
}

/** "Dra. Helena Prado" → "HP". */
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter((p) => !/^dra?\.?$/i.test(p))
  if (partes.length === 0) return ''
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : ''
  return (partes[0][0] + ultima).toUpperCase()
}

/** Bolinha com as iniciais do dentista, na cor dele. */
function IniciaisProf({ prof }: { prof: Professional }) {
  return (
    <span
      className="w-6 h-6 rounded-full grid place-items-center text-[10px] font-bold text-white shrink-0"
      style={{ backgroundColor: prof.color || '#5E6E75' }}
      aria-hidden="true"
    >
      {iniciais(prof.name)}
    </span>
  )
}

/** Linha de paciente nos cartões do painel do dia. */
function PainelLinha({ apt, cor, detalhe, onClick }: {
  apt: Appointment
  cor: { bg: string; fg: string }
  detalhe: string
  onClick: (el: HTMLElement) => void
}) {
  const nome = apt.patient?.name || 'Paciente'
  return (
    <li className="border-t border-porcelana first:border-t-0">
      <button
        onClick={(e) => onClick(e.currentTarget)}
        className="w-full flex items-center gap-2.5 py-2 text-left rounded-md hover:bg-porcelana-2 transition-colors"
      >
        <span
          className="w-8 h-8 rounded-full grid place-items-center text-[11px] font-bold shrink-0"
          style={{ backgroundColor: cor.bg, color: cor.fg }}
          aria-hidden="true"
        >
          {iniciais(nome)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-tinta truncate">{nome}</span>
          <span className="block text-[12.5px] text-tinta-4 truncate tabular-nums">{detalhe}</span>
        </span>
      </button>
    </li>
  )
}
