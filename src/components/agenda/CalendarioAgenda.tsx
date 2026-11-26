'use client'

import { useRef, useEffect } from 'react'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import ptBRLocale from '@fullcalendar/core/locales/pt-br'
import { Check, CheckCheck, Clock, MessageCircle } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { Appointment } from '@/types'
import { APPOINTMENT_STATUS_COLORS, APPOINTMENT_STATUS_SOFT } from '@/types'
import { nomeExibicao } from '@/lib/agenda/nome'
import { faixaAgenda } from '@/lib/agenda/faixa'
import type { WhatsAppIndicator } from './useWhatsAppStatus'

interface CalendarioAgendaProps {
  view: 'timeGridWeek' | 'timeGridDay'
  currentDate: Date
  appointments: Appointment[]
  indicators?: Map<string, WhatsAppIndicator>
  onDateClick: (date: Date, hour: string) => void
  onEventClick: (appointment: Appointment, rect: DOMRect) => void
}

// Fora do componente de propósito: uma lista nova a cada render faz o FullCalendar
// recalcular a semana e voltar a rolagem para o início (ex.: ao abrir o card da consulta).
const DIAS_OCULTOS = [0]
// "17:00" em vez de "17" na coluna de horários (também fora do componente, pelo mesmo motivo).
const FORMATO_HORARIO = { hour: '2-digit', minute: '2-digit', hour12: false } as const

export function CalendarioAgenda({
  view,
  currentDate,
  appointments,
  indicators,
  onDateClick,
  onEventClick,
}: CalendarioAgendaProps) {
  const calendarRef = useRef<FullCalendar>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const api = calendarRef.current?.getApi()
    if (api) {
      api.changeView(view)
      api.gotoDate(currentDate)
    }
  }, [view, currentDate])

  // Redimensiona o FC quando o container muda de tamanho (ex: sidebar colapsa)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      calendarRef.current?.getApi().updateSize()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 7h às 21h, esticando para mostrar consultas fora disso (strings: não recriam a semana à toa).
  const faixa = faixaAgenda(appointments)

  // Bloco em tom suave do status; a cor do dentista vai na borda esquerda.
  const events = appointments.map((apt) => {
    const soft = APPOINTMENT_STATUS_SOFT[apt.status] ?? APPOINTMENT_STATUS_SOFT.scheduled
    return {
      id: apt.id,
      title: nomeExibicao(apt.patient?.name || 'Paciente'),
      start: apt.start_time,
      end: apt.end_time,
      backgroundColor: soft.bg,
      textColor: soft.fg,
      borderColor: 'transparent',
      classNames: [`ev-${apt.status}`],
      extendedProps: { appointment: apt },
    }
  })

  return (
    <div ref={containerRef} className="h-full fc-dental">
      <FullCalendar
        ref={calendarRef}
        plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
        initialView={view}
        initialDate={currentDate}
        locale={ptBRLocale}
        headerToolbar={false}
        events={events}
        slotMinTime={faixa.inicio}
        slotMaxTime={faixa.fim}
        slotLabelFormat={FORMATO_HORARIO}
        allDaySlot={false}
        slotDuration="00:30:00"
        height="100%"
        nowIndicator={true}
        editable={false}
        selectable={true}
        selectMirror={true}
        slotEventOverlap={false}
        hiddenDays={DIAS_OCULTOS}
        dateClick={(info) => {
          const date = info.date
          const hour = info.dateStr.split('T')[1]?.slice(0, 5) || '09:00'
          setTimeout(() => onDateClick(date, hour), 0)
        }}
        dayHeaderContent={(arg) => (
          <span className="fc-dia">
            <small>{format(arg.date, 'EEE', { locale: ptBR }).replace('.', '')}</small>
            <strong>{format(arg.date, 'd')}</strong>
          </span>
        )}
        eventDidMount={(info) => {
          const apt = info.event.extendedProps.appointment as Appointment | undefined
          const profColor = apt?.professional?.color || apt?.color
          if (profColor) info.el.style.setProperty('--prof', profColor)

          const harness = info.el.parentElement as HTMLElement | null
          if (!harness) return

          const expand = () => {
            if (!harness.dataset.origLeft) {
              harness.dataset.origLeft = harness.style.left || '0%'
              harness.dataset.origRight = harness.style.right || '0%'
            }
            harness.style.transition = 'left 0.12s ease, right 0.12s ease'
            harness.style.left = '0%'
            harness.style.right = '0%'
            harness.style.zIndex = '20'
          }

          const collapse = () => {
            harness.style.transition = 'left 0.12s ease, right 0.12s ease'
            harness.style.left = harness.dataset.origLeft ?? '0%'
            harness.style.right = harness.dataset.origRight ?? '0%'
            harness.style.zIndex = ''
            delete harness.dataset.origLeft
            delete harness.dataset.origRight
          }

          info.el.addEventListener('mouseenter', expand)
          info.el.addEventListener('mouseleave', collapse)
        }}
        eventClick={(info) => {
          const apt = info.event.extendedProps.appointment as Appointment
          const rect = info.el.getBoundingClientRect()
          setTimeout(() => onEventClick(apt, rect), 0)
        }}
        eventMinHeight={44}
        eventContent={(eventInfo) => {
          const apt = eventInfo.event.extendedProps.appointment as Appointment | undefined
          if (!apt?.start_time) {
            return <div style={{ padding: '3px 7px', fontSize: 12, fontWeight: 600 }}>{eventInfo.event.title}</div>
          }
          const start = new Date(apt.start_time)
          const end = new Date(apt.end_time)
          const mins = (end.getTime() - start.getTime()) / 60000
          const compact = mins <= 30
          const indicator = indicators?.get(apt.id)

          const plano = apt.patient?.insurance_plan?.name

          return (
            <div
              title={[eventInfo.event.title, `${eventInfo.timeText}${plano ? `, ${plano}` : ''}`].join('\n')}
              style={{
                padding: compact ? '3px 6px 3px 7px' : '5px 8px',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-start',
                gap: compact ? 0 : 2,
                overflow: 'hidden',
              }}
            >
              {/* nome do paciente, em até duas linhas */}
              <div className="ev-nome" style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.17 }}>
                {indicator && (
                  <span
                    title={indicator === 'confirmed' ? 'Confirmada pelo WhatsApp' : 'Confirmação enviada'}
                    style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 4 }}
                  >
                    {indicator === 'confirmed'
                      ? <CheckCheck size={13} strokeWidth={3} aria-label="Confirmada pelo WhatsApp" />
                      : <Check size={13} strokeWidth={3} style={{ opacity: 0.6 }} aria-label="Confirmação enviada" />}
                  </span>
                )}
                {apt.source === 'whatsapp' && (
                  <span title="Marcada pelo WhatsApp" style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 4 }}>
                    <MessageCircle size={13} strokeWidth={2.5} aria-label="Marcada pelo WhatsApp" />
                  </span>
                )}
                {apt.status === 'in_progress' && <span className="ev-pulso" title="Em atendimento" aria-label="Em atendimento" />}
                {apt.status === 'waiting' && (
                  <span title="Na sala de espera" style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 4 }}>
                    <Clock size={12} strokeWidth={2.6} aria-label="Na sala de espera" />
                  </span>
                )}
                {eventInfo.event.title}
              </div>

              {/* horário, com a cor da situação; plano só nos blocos maiores */}
              <div className="ev-hora" style={{ fontSize: 11, lineHeight: 1.25, opacity: 0.85 }}>
                <span className="ev-ponto" style={{ backgroundColor: APPOINTMENT_STATUS_COLORS[apt.status] }} aria-hidden="true" />
                {eventInfo.timeText}
                {!compact && plano ? `, ${plano}` : ''}
              </div>

              {/* procedimento (só nos blocos maiores; nos de 30 min fica no popup) */}
              {!compact && apt?.procedure && (
                <div style={{
                  fontSize: 11.5,
                  opacity: 0.85,
                  lineHeight: 1.2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {apt.procedure}
                </div>
              )}
            </div>
          )
        }}
      />
    </div>
  )
}
