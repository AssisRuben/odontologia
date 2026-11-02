import type { MessagingConfig } from './types'
import { todayYmd, zonedDateTime } from './time'

/** Janela de envio: início inclusivo, fim exclusivo, no fuso da clínica. */
export function isWithinSendWindow(now: Date, cfg: MessagingConfig): boolean {
  const ymd = todayYmd(now, cfg.timezone)
  const start = zonedDateTime(ymd, cfg.window_start, cfg.timezone)
  const end = zonedDateTime(ymd, cfg.window_end, cfg.timezone)
  return now >= start && now < end
}

/** Hoje 00:00 no fuso da clínica. */
export function startOfClinicDay(now: Date, tz: string): Date {
  return zonedDateTime(todayYmd(now, tz), '00:00', tz)
}

/** Hoje no início da janela de envio, no fuso da clínica. */
export function windowStartToday(now: Date, cfg: MessagingConfig): Date {
  return zonedDateTime(todayYmd(now, cfg.timezone), cfg.window_start, cfg.timezone)
}
