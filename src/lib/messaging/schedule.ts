import { linkUrl } from '@/lib/orcamentos/links'
import { normalizePhone } from './phone'
import { buildContext, renderTemplate } from './templates'
import { todayYmd, zonedDateTime } from './time'
import { windowStartToday } from './window'
import type {
  AppointmentRow,
  BudgetReminderRow,
  MessageKind,
  MessageSetting,
  MessageType,
  MessagingConfig,
  PatientRow,
  PaymentRow,
  QueueItem,
} from './types'

export interface PlanInput {
  now: Date
  clinicId: string
  clinicName: string
  cfg: MessagingConfig
  settings: MessageSetting[]
  patients: Map<string, PatientRow>
  /** start_time em (now, now + 48h], status scheduled|confirmed */
  upcoming: AppointmentRow[]
  /** última consulta concluída por paciente */
  lastCompleted: { patient_id: string; appointment_id: string; start_time: string }[]
  /** pacientes com consulta futura não cancelada */
  patientsWithFuture: Set<string>
  /** status pending|overdue com due_date */
  payments: PaymentRow[]
  /** orçamentos 'sent' com link ativo */
  budgets: BudgetReminderRow[]
}

export function dedupeKey(
  type: MessageType,
  parts: {
    appointmentId?: string
    startTime?: string
    patientId?: string
    lastAppointmentId?: string
    year?: number
    paymentId?: string
    offsetDays?: number
    budgetId?: string
    linkId?: string
  },
): string {
  switch (type) {
    case 'confirmation':
    case 'reminder':
      return `${type}:${parts.appointmentId}:${normalizeIso(parts.startTime!)}`
    case 'recall':
      return `recall:${parts.patientId}:${parts.lastAppointmentId}`
    case 'birthday':
      return `birthday:${parts.patientId}:${parts.year}`
    case 'charge':
      return `charge:${parts.paymentId}:${parts.offsetDays}`
    case 'payment_due':
      return `payment_due:${parts.paymentId}:${parts.offsetDays}`
    case 'budget_reminder':
      return `budget_reminder:${parts.budgetId}:${parts.linkId}:${parts.offsetDays}`
    case 'budget':
      throw new Error('envio de orçamento é manual (sem dedupe_key)')
  }
}

function normalizeIso(s: string): string {
  return new Date(s).toISOString()
}

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/** Recall só vale para quem completou o intervalo há no máximo N dias (evita disparo em massa). */
export const RECALL_MAX_LATE_DAYS = 30

/** Soma meses em componentes UTC (independe do fuso do servidor), limitando o dia ao fim do mês. */
function addMonthsUtc(d: Date, months: number): Date {
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + months
  const y = Math.floor(total / 12)
  const m = total % 12
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay),
    d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()))
}

type Ctx = {
  input: PlanInput
  setting: MessageSetting
  /** Retorna o paciente apto a receber (existe, sem opt-out, com telefone). */
  target: (patientId: string) => { patient: PatientRow; phone: string } | null
}

type Partial_ = Omit<QueueItem, 'clinic_id' | 'phone' | 'body' | 'patient_id' | 'type'>

function build(
  c: Ctx,
  t: { patient: PatientRow; phone: string },
  extra: Partial_,
  ctxArgs: { appointment?: AppointmentRow; payment?: PaymentRow; budget?: { total: number; valid_until: string | null }; link?: string } = {},
): QueueItem {
  const { input, setting } = c
  const context = buildContext({
    patient: t.patient,
    clinicName: input.clinicName,
    tz: input.cfg.timezone,
    ...ctxArgs,
  })
  return {
    clinic_id: input.clinicId,
    patient_id: t.patient.id,
    type: setting.type,
    phone: t.phone,
    body: renderTemplate(setting.template, context),
    ...extra,
  }
}

function planAppointmentReminders(c: Ctx, type: 'confirmation' | 'reminder'): QueueItem[] {
  const { now, upcoming } = c.input
  const status = type === 'confirmation' ? 'scheduled' : 'confirmed'
  const limit = new Date(now.getTime() + (c.setting.config.offset_hours ?? 0) * HOUR_MS)
  const out: QueueItem[] = []
  for (const a of upcoming) {
    const start = new Date(a.start_time)
    if (a.status !== status || start <= now || start > limit) continue
    const t = c.target(a.patient_id)
    if (!t) continue
    out.push(
      build(
        c,
        t,
        {
          appointment_id: a.id,
          payment_id: null,
          budget_id: null,
          scheduled_for: now,
          expires_at: start,
          dedupe_key: dedupeKey(type, { appointmentId: a.id, startTime: a.start_time }),
        },
        { appointment: a },
      ),
    )
  }
  return out
}

function planRecall(c: Ctx): QueueItem[] {
  const { input, setting } = c
  const months = setting.config.offset_months ?? 0
  const out: QueueItem[] = []
  for (const l of input.lastCompleted) {
    if (input.patientsWithFuture.has(l.patient_id)) continue
    const due = addMonthsUtc(new Date(l.start_time), months)
    if (due > input.now || due.getTime() <= input.now.getTime() - RECALL_MAX_LATE_DAYS * DAY_MS) continue
    const t = c.target(l.patient_id)
    if (!t) continue
    out.push(
      build(c, t, {
        appointment_id: null,
        payment_id: null,
          budget_id: null,
        scheduled_for: windowStartToday(input.now, input.cfg),
        expires_at: null,
        dedupe_key: dedupeKey('recall', { patientId: l.patient_id, lastAppointmentId: l.appointment_id }),
      }),
    )
  }
  return out
}

function planBirthdays(c: Ctx): QueueItem[] {
  const { input } = c
  const { now, cfg } = input
  const today = todayYmd(now, cfg.timezone)
  const [year, month, day] = today.split('-').map(Number)
  const leap = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1
  const out: QueueItem[] = []
  for (const patient of input.patients.values()) {
    if (!patient.birthdate) continue
    const [, bm, bd] = patient.birthdate.slice(0, 10).split('-').map(Number)
    const isToday =
      (bm === month && bd === day) || (bm === 2 && bd === 29 && !leap && month === 2 && day === 28)
    if (!isToday) continue
    const t = c.target(patient.id)
    if (!t) continue
    out.push(
      build(c, t, {
        appointment_id: null,
        payment_id: null,
          budget_id: null,
        scheduled_for: zonedDateTime(today, '09:00', cfg.timezone),
        expires_at: zonedDateTime(today, cfg.window_end, cfg.timezone),
        dedupe_key: dedupeKey('birthday', { patientId: patient.id, year }),
      }),
    )
  }
  return out
}

function ymdToDays(ymd: string): number {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

function planCharges(c: Ctx, type: 'charge' | 'payment_due'): QueueItem[] {
  const { input, setting } = c
  const today = ymdToDays(todayYmd(input.now, input.cfg.timezone))
  const offsets = setting.config.offset_days ?? []
  const out: QueueItem[] = []
  for (const p of input.payments) {
    if (!p.due_date || (p.status !== 'pending' && p.status !== 'overdue')) continue
    if (p.provider_state === 'creating') continue
    if (type === 'payment_due' && !p.invoice_url) continue
    // charge: dias após o vencimento; payment_due: dias antes
    const elapsed = type === 'charge' ? today - ymdToDays(p.due_date) : ymdToDays(p.due_date) - today
    if (!offsets.includes(elapsed)) continue
    const t = c.target(p.patient_id)
    if (!t) continue
    out.push(
      build(
        c,
        t,
        {
          appointment_id: null,
          payment_id: p.id,
          budget_id: null,
          scheduled_for: windowStartToday(input.now, input.cfg),
          expires_at: null,
          dedupe_key: dedupeKey(type, { paymentId: p.id, offsetDays: elapsed }),
        },
        { payment: p },
      ),
    )
  }
  return out
}

function planBudgetReminders(c: Ctx): QueueItem[] {
  const { input, setting } = c
  const tz = input.cfg.timezone
  const today = ymdToDays(todayYmd(input.now, tz))
  const offsets = setting.config.offset_days ?? []
  const out: QueueItem[] = []
  for (const b of input.budgets) {
    if (b.valid_until && ymdToDays(b.valid_until) < today) continue
    const elapsed = today - ymdToDays(todayYmd(new Date(b.link_created_at), tz))
    if (!offsets.includes(elapsed)) continue
    const t = c.target(b.patient_id)
    if (!t) continue
    out.push(
      build(
        c,
        t,
        {
          appointment_id: null,
          payment_id: null,
          budget_id: b.id,
          scheduled_for: windowStartToday(input.now, input.cfg),
          expires_at: null,
          dedupe_key: dedupeKey('budget_reminder', { budgetId: b.id, linkId: b.link_id, offsetDays: elapsed }),
        },
        { budget: { total: b.total, valid_until: b.valid_until }, link: linkUrl(b.token) },
      ),
    )
  }
  return out
}

export function planMessages(input: PlanInput): QueueItem[] {
  const target = (patientId: string) => {
    const patient = input.patients.get(patientId)
    if (!patient || patient.whatsapp_opt_out) return null
    const phone = normalizePhone(patient.whatsapp) ?? normalizePhone(patient.phone)
    return phone ? { patient, phone } : null
  }
  const out: QueueItem[] = []
  for (const setting of input.settings) {
    if (!setting.enabled) continue
    const c: Ctx = { input, setting, target }
    switch (setting.type) {
      case 'confirmation':
      case 'reminder':
        out.push(...planAppointmentReminders(c, setting.type))
        break
      case 'recall':
        out.push(...planRecall(c))
        break
      case 'birthday':
        out.push(...planBirthdays(c))
        break
      case 'charge':
      case 'payment_due':
        out.push(...planCharges(c, setting.type))
        break
      case 'budget_reminder':
        out.push(...planBudgetReminders(c))
        break
      case 'budget':
        break // envio manual: nunca planejado pela rotina
    }
  }
  return out
}

export type StaleReason = 'appointment_changed' | 'not_confirmed' | 'paid' | 'opt_out' | 'expired' | 'decided' | null

/** start_time embutido em `type:<appointment_id>:<ISO>` (o ISO contém ':'). */
export function keyStartTime(key: string | null): string | null {
  const parts = (key ?? '').split(':')
  return parts.length > 2 ? parts.slice(2).join(':') : null
}

export function staleReason(
  item: { type: MessageKind; dedupe_key: string | null; expires_at: string | null },
  now: Date,
  ctx: {
    appointment?: { start_time: string; status: string } | null
    payment?: { status: string } | null
    budget?: { status: string; active_link_id: string | null } | null
    patient?: { whatsapp_opt_out: boolean } | null
  },
): StaleReason {
  if (ctx.patient?.whatsapp_opt_out) return 'opt_out'
  if (item.expires_at && new Date(item.expires_at) < now) return 'expired'

  if (item.type === 'confirmation' || item.type === 'reminder') {
    const a = ctx.appointment
    if (!a || a.status === 'cancelled' || a.status === 'no_show') return 'appointment_changed'
    const keyStart = keyStartTime(item.dedupe_key)
    if (keyStart === null || normalizeIso(keyStart) !== normalizeIso(a.start_time)) {
      return 'appointment_changed'
    }
    if (item.type === 'reminder' && a.status !== 'confirmed') return 'not_confirmed'
    return null
  }
  if (item.type === 'charge' || item.type === 'payment_due') {
    const st = ctx.payment?.status
    if (!st || st === 'paid' || st === 'cancelled' || st === 'refunded') return 'paid'
  }
  if (item.type === 'budget_reminder') {
    const b = ctx.budget
    const keyLink = (item.dedupe_key ?? '').split(':')[2]
    if (!b || b.status !== 'sent' || !b.active_link_id || b.active_link_id !== keyLink) return 'decided'
  }
  return null
}
