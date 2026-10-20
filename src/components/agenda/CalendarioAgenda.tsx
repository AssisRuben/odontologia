'use client'

import { useRef, useEffect } from 'react'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import ptBRLocale from '@fullcalendar/core/locales/pt-br'
import type { Appointment } from '@/types'
import { APPOINTMENT_STATUS_COLORS } from '@/types'

interface CalendarioAgendaProps {
  view: 'timeGridWeek' | 'timeGridDay'
  currentDate: Date
  appointments: Appointment[]
  onDateClick: (date: Date, hour: string) => void
  onEventClick: (appointment: Appointment, rect: DOMRect) => void
}

export function CalendarioAgenda({
  view,
  currentDate,
  appointments,
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

  const events = appointments.map((apt) => ({
    id: apt.id,
    title: apt.patient?.name || 'Paciente',
    start: apt.start_time,
    end: apt.end_time,
    backgroundColor: APPOINTMENT_STATUS_COLORS[apt.status] || apt.color || '#3B82F6',
    borderColor: 'transparent',
    extendedProps: { appointment: apt },
  }))

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
        slotMinTime="07:30:00"
        slotMaxTime="18:00:00"
        allDaySlot={false}
        slotDuration="00:30:00"
        height="100%"
        nowIndicator={true}
        editable={false}
        selectable={true}
        selectMirror={true}
        slotEventOverlap={false}
        hiddenDays={[0]}
        dateClick={(info) => {
          const date = info.date
          const hour = info.dateStr.split('T')[1]?.slice(0, 5) || '09:00'
          setTimeout(() => onDateClick(date, hour), 0)
        }}
        eventDidMount={(info) => {
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
            return <div style={{ padding: '3px 7px', fontSize: 12, fontWeight: 700, color: '#fff' }}>{eventInfo.event.title}</div>
          }
          const start = new Date(apt.start_time)
          const end = new Date(apt.end_time)
          const mins = (end.getTime() - start.getTime()) / 60000
          const compact = mins <= 30

          return (
            <div style={{
              padding: compact ? '3px 7px' : '5px 8px',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: compact ? 'center' : 'flex-start',
              gap: compact ? 0 : 2,
              overflow: 'hidden',
            }}>
              {/* nome do paciente */}
              <div style={{
                fontSize: 12,
                fontWeight: 700,
                color: '#fff',
                lineHeight: 1.25,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {eventInfo.event.title}
              </div>

              {/* procedimento */}
              {apt?.procedure && (
                <div style={{
                  fontSize: 10,
                  color: 'rgba(255,255,255,0.88)',
                  lineHeight: 1.2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {apt.procedure}
                </div>
              )}

              {/* horário + plano (só em eventos mais longos) */}
              {!compact && (
                <div style={{
                  fontSize: 10,
                  color: 'rgba(255,255,255,0.72)',
                  lineHeight: 1.2,
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {eventInfo.timeText}
                  {apt?.patient?.insurance_plan ? ` · ${apt.patient.insurance_plan.name}` : ''}
                </div>
              )}
            </div>
          )
        }}
      />
    </div>
  )
}
