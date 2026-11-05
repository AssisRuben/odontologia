import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlanInput } from './schedule'
import type { AppointmentRow, MessageSetting, MessagingConfig, PatientRow, PaymentRow } from './types'

const HOUR_MS = 3_600_000
const PAGE = 1000

/** Lê todas as linhas de uma consulta, página a página (o Supabase limita 1000 por requisição). */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGE) return out
  }
}

/** Horizonte (horas) das consultas futuras a considerar: no mínimo 48 h ou o maior offset configurado. */
export function horizonHours(settings: MessageSetting[]): number {
  const offsets = settings
    .filter((s) => s.type === 'confirmation' || s.type === 'reminder')
    .map((s) => s.config.offset_hours ?? 0)
  return Math.max(48, ...offsets)
}

interface RawUpcoming {
  id: string
  patient_id: string
  start_time: string
  status: string
  professionals: { name: string | null } | { name: string | null }[] | null
}

export async function loadPlanInput(
  admin: SupabaseClient,
  args: { clinicId: string; clinicName: string; cfg: MessagingConfig; settings: MessageSetting[]; now: Date },
): Promise<PlanInput> {
  const { clinicId, clinicName, cfg, settings, now } = args
  const nowIso = now.toISOString()
  const horizonIso = new Date(now.getTime() + horizonHours(settings) * HOUR_MS).toISOString()

  const [patientRows, upcomingRaw, completed, future, payments] = await Promise.all([
    fetchAll<PatientRow>((a, b) =>
      admin
        .from('patients')
        .select('id, name, phone, whatsapp, birthdate, whatsapp_opt_out')
        .eq('clinic_id', clinicId)
        .order('id')
        .range(a, b),
    ),
    fetchAll<RawUpcoming>((a, b) =>
      admin
        .from('appointments')
        .select('id, patient_id, start_time, status, professionals(name)')
        .eq('clinic_id', clinicId)
        .in('status', ['scheduled', 'confirmed'])
        .gt('start_time', nowIso)
        .lte('start_time', horizonIso)
        .order('start_time')
        .order('id')
        .range(a, b),
    ),
    fetchAll<{ id: string; patient_id: string; start_time: string }>((a, b) =>
      admin
        .from('appointments')
        .select('id, patient_id, start_time')
        .eq('clinic_id', clinicId)
        .eq('status', 'completed')
        .lte('start_time', nowIso)
        .order('start_time')
        .order('id')
        .range(a, b),
    ),
    fetchAll<{ patient_id: string }>((a, b) =>
      admin
        .from('appointments')
        .select('id, patient_id')
        .eq('clinic_id', clinicId)
        .gt('start_time', nowIso)
        .not('status', 'in', '(cancelled,no_show)')
        .order('id')
        .range(a, b),
    ),
    fetchAll<PaymentRow>((a, b) =>
      admin
        .from('payments')
        .select('id, patient_id, amount, due_date, status, invoice_url, provider_state')
        .eq('clinic_id', clinicId)
        .in('status', ['pending', 'overdue'])
        .not('due_date', 'is', null)
        .order('id')
        .range(a, b),
    ),
  ])

  const upcoming: AppointmentRow[] = upcomingRaw.map((r) => {
    const prof = Array.isArray(r.professionals) ? r.professionals[0] : r.professionals
    return {
      id: r.id,
      patient_id: r.patient_id,
      start_time: r.start_time,
      status: r.status,
      professional_name: prof?.name ?? null,
    }
  })

  const latest = new Map<string, { patient_id: string; appointment_id: string; start_time: string }>()
  for (const c of completed) {
    const cur = latest.get(c.patient_id)
    if (!cur || new Date(c.start_time) > new Date(cur.start_time)) {
      latest.set(c.patient_id, { patient_id: c.patient_id, appointment_id: c.id, start_time: c.start_time })
    }
  }

  return {
    now,
    clinicId,
    clinicName,
    cfg,
    settings,
    patients: new Map(patientRows.map((p) => [p.id, p])),
    upcoming,
    lastCompleted: [...latest.values()],
    patientsWithFuture: new Set(future.map((f) => f.patient_id)),
    payments,
  }
}
