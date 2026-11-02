import type { SupabaseClient } from '@supabase/supabase-js'
import type { WhatsAppProvider } from '@/lib/whatsapp/provider'
import { fetchAll, loadPlanInput } from './cycleData'
import { createSupabaseQueueRepo } from './repo'
import { planMessages, staleReason } from './schedule'
import { processQueue } from './sender'
import type { MessageKind, MessageSetting, MessagingConfig } from './types'

export interface ClinicCycleResult {
  planned: number
  cancelled: number
  sent: number
  failed: number
  skippedReason?: string
  error?: string
}

interface QueuedRow {
  id: string
  type: MessageKind
  dedupe_key: string | null
  expires_at: string | null
  appointment_id: string | null
  patient_id: string | null
  payment_id: string | null
}

function check(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

async function byIds<T extends { id: string }>(
  admin: SupabaseClient,
  clinicId: string,
  table: string,
  columns: string,
  ids: string[],
): Promise<Map<string, T>> {
  const map = new Map<string, T>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin.from(table).select(columns).eq('clinic_id', clinicId).in('id', ids.slice(i, i + 200))
    check(error)
    for (const r of (data ?? []) as unknown as T[]) map.set(r.id, r)
  }
  return map
}

/** Cancela itens 'queued' que deixaram de fazer sentido. Retorna quantos foram cancelados. */
async function cancelStale(
  admin: SupabaseClient,
  clinicId: string,
  now: Date,
  patients: Map<string, { whatsapp_opt_out: boolean }>,
): Promise<number> {
  const rows = await fetchAll<QueuedRow>((from, to) =>
    admin
      .from('messages')
      .select('id, type, dedupe_key, expires_at, appointment_id, patient_id, payment_id')
      .eq('clinic_id', clinicId)
      .eq('status', 'queued')
      .not('dedupe_key', 'is', null)
      .order('id')
      .range(from, to),
  )
  if (!rows.length) return 0

  const ids = (pick: (r: QueuedRow) => string | null) =>
    [...new Set(rows.map(pick).filter((v): v is string => !!v))]
  const missingPatients = ids((r) => r.patient_id).filter((id) => !patients.has(id))
  const [appointments, payments, extraPatients] = await Promise.all([
    byIds<{ id: string; start_time: string; status: string }>(
      admin, clinicId, 'appointments', 'id, start_time, status', ids((r) => r.appointment_id)),
    byIds<{ id: string; status: string }>(admin, clinicId, 'payments', 'id, status', ids((r) => r.payment_id)),
    byIds<{ id: string; whatsapp_opt_out: boolean }>(
      admin, clinicId, 'patients', 'id, whatsapp_opt_out', missingPatients),
  ])

  const byReason = new Map<string, string[]>()
  for (const row of rows) {
    const reason = staleReason(row, now, {
      appointment: row.appointment_id ? (appointments.get(row.appointment_id) ?? null) : null,
      payment: row.payment_id ? (payments.get(row.payment_id) ?? null) : null,
      patient: row.patient_id
        ? (patients.get(row.patient_id) ?? extraPatients.get(row.patient_id) ?? null)
        : null,
    })
    if (reason) byReason.set(reason, [...(byReason.get(reason) ?? []), row.id])
  }

  let cancelled = 0
  for (const [reason, ids] of byReason) {
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200)
      const { data, error: upErr } = await admin
        .from('messages')
        .update({ status: 'cancelled', error: reason })
        .in('id', chunk)
        .eq('status', 'queued')
        .select('id')
      check(upErr) // falhar aqui impede o envio desta clínica no ciclo
      cancelled += data?.length ?? 0
    }
  }
  return cancelled
}

async function runClinic(
  admin: SupabaseClient,
  provider: WhatsAppProvider,
  conn: { clinic_id: string; instance: string; token: string },
  now: Date,
  deadline: Date,
): Promise<ClinicCycleResult> {
  const clinicId = conn.clinic_id
  const [clinicRes, settingsRes] = await Promise.all([
    admin.from('clinics').select('name, messaging_config').eq('id', clinicId).single(),
    admin.from('message_settings').select('type, enabled, template, config').eq('clinic_id', clinicId),
  ])
  check(clinicRes.error)
  check(settingsRes.error)
  const clinic = clinicRes.data as { name: string; messaging_config: MessagingConfig }
  const settings = (settingsRes.data ?? []) as MessageSetting[]

  const input = await loadPlanInput(admin, {
    clinicId,
    clinicName: clinic.name,
    cfg: clinic.messaging_config,
    settings,
    now,
  })
  const items = planMessages(input)
  if (items.length) {
    const rows = items.map((i) => ({
      ...i,
      scheduled_for: i.scheduled_for.toISOString(),
      expires_at: i.expires_at ? i.expires_at.toISOString() : null,
      direction: 'out',
      status: 'queued',
      attempts: 0,
    }))
    const { error } = await admin
      .from('messages')
      .upsert(rows, { onConflict: 'clinic_id,dedupe_key', ignoreDuplicates: true })
    check(error)
  }

  const cancelled = await cancelStale(admin, clinicId, now, input.patients)
  if (Date.now() >= deadline.getTime()) {
    return { planned: items.length, cancelled, sent: 0, failed: 0, skippedReason: 'deadline' }
  }
  const res = await processQueue({
    clinicId,
    cfg: clinic.messaging_config,
    instance: conn.instance,
    token: conn.token,
    connected: true,
    repo: createSupabaseQueueRepo(admin),
    provider,
    deps: {
      now: () => new Date(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      random: Math.random,
      deadline,
    },
  })
  return {
    planned: items.length,
    cancelled,
    sent: res.sent,
    failed: res.failed,
    ...(res.skippedReason ? { skippedReason: res.skippedReason } : {}),
  }
}

export async function runCycle(
  admin: SupabaseClient,
  provider: WhatsAppProvider,
  now: Date,
  deadline: Date,
): Promise<Record<string, ClinicCycleResult>> {
  const { data, error } = await admin
    .from('whatsapp_connections')
    .select('clinic_id, instance, token')
    .eq('status', 'connected')
  check(error)

  const results: Record<string, ClinicCycleResult> = {}
  for (const conn of (data ?? []) as { clinic_id: string; instance: string; token: string }[]) {
    if (Date.now() >= deadline.getTime()) break
    try {
      results[conn.clinic_id] = await runClinic(admin, provider, conn, now, deadline)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido'
      console.error('[cron] clinic', conn.clinic_id, message)
      results[conn.clinic_id] = {
        planned: 0,
        cancelled: 0,
        sent: 0,
        failed: 0,
        error: message,
      }
    }
  }
  return results
}
