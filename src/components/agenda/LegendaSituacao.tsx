import { APPOINTMENT_STATUS_COLORS, APPOINTMENT_STATUS_LABELS, APPOINTMENT_STATUS_SOFT, type AppointmentStatus } from '@/types'

const ORDEM: AppointmentStatus[] = ['scheduled', 'confirmed', 'waiting', 'in_progress', 'completed', 'no_show', 'cancelled']

/** O que cada cor dos blocos da agenda quer dizer. */
export function LegendaSituacao() {
  return (
    <ul aria-label="Cores das situações" className="flex flex-wrap gap-x-3.5 gap-y-1 px-3 md:px-4 py-2 border-b border-linha text-xs text-tinta-2">
      {ORDEM.map((s) => (
        <li key={s} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="w-2.5 h-2.5 rounded-[3px]"
            style={{ backgroundColor: APPOINTMENT_STATUS_SOFT[s].bg, boxShadow: `inset 0 0 0 1.5px ${APPOINTMENT_STATUS_COLORS[s]}` }}
          />
          {APPOINTMENT_STATUS_LABELS[s]}
        </li>
      ))}
    </ul>
  )
}
