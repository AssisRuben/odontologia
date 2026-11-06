import type { SupabaseClient } from '@supabase/supabase-js'
import type { WhatsAppProvider } from '@/lib/whatsapp/provider'
import { normalizeMessagingConfig } from './config'
import { fetchAll, loadPlanInput } from './cycleData'
import { createSupabaseQueueRepo } from './repo'
import { planMessages, staleReason } from './schedule'
import { processQueue, type ProcessResult } from './sender'
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
  budget_id: string | null
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

/** Link ativo (não revogado) de cada orçamento informado. */
async function activeLinkIds(admin: SupabaseClient, clinicId: string, budgetIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (let i = 0; i < budgetIds.length; i += 200) {
    const { data, error } = await admin
      .from('budget_links')
      .select('id, budget_id')
      .eq('clinic_id', clinicId)
      .is('revoked_at', null)
      .in('budget_id', budgetIds.slice(i, i + 200))
    check(error)
    for (const r of (data ?? []) as { id: string; budget_id: string }[]) map.set(r.budget_id, r.id)
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
      .select('id, type, dedupe_key, expires_at, appointment_id, patient_id, payment_id, budget_id')
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
  const [appointments, payments, budgetStatus, activeLinks, extraPatients] = await Promise.all([
    byIds<{ id: string; start_time: string; status: string }>(
      admin, clinicId, 'appointments', 'id, start_time, status', ids((r) => r.appointment_id)),
    byIds<{ id: string; status: string }>(admin, clinicId, 'payments', 'id, status', ids((r) => r.payment_id)),
    byIds<{ id: string; status: string }>(admin, clinicId, 'budgets', 'id, status', ids((r) => r.budget_id)),
    activeLinkIds(admin, clinicId, ids((r) => r.budget_id)),
    byIds<{ id: string; whatsapp_opt_out: boolean }>(
      admin, clinicId, 'patients', 'id, whatsapp_opt_out', missingPatients),
  ])

  const byReason = new Map<string, string[]>()
  for (const row of rows) {
    const reason = staleReason(row, now, {
      appointment: row.appointment_id ? (appointments.get(row.appointment_id) ?? null) : null,
      payment: row.payment_id ? (payments.get(row.payment_id) ?? null) : null,
      budget: row.budget_id
        ? { status: budgetStatus.get(row.budget_id)?.status ?? 'missing', active_link_id: activeLinks.get(row.budget_id) ?? null }
        : null,
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

interface Conn {
  clinic_id: string
  instance: string
  token: string
}

interface Prepared {
  cfg: MessagingConfig
  planned: number
  cancelled: number
}

/** Fase 1 (barata): planeja a fila da clínica e cancela itens que deixaram de fazer sentido. */
async function prepareClinic(admin: SupabaseClient, conn: Conn, now: Date): Promise<Prepared> {
  const clinicId = conn.clinic_id
  const [clinicRes, settingsRes] = await Promise.all([
    admin.from('clinics').select('name, messaging_config').eq('id', clinicId).single(),
    admin.from('message_settings').select('type, enabled, template, config').eq('clinic_id', clinicId),
  ])
  check(clinicRes.error)
  check(settingsRes.error)
  const clinic = clinicRes.data as { name: string; messaging_config: unknown }
  const cfg = normalizeMessagingConfig(clinic.messaging_config)
  const settings = (settingsRes.data ?? []) as MessageSetting[]

  const input = await loadPlanInput(admin, {
    clinicId,
    clinicName: clinic.name,
    cfg,
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
  return { cfg, planned: items.length, cancelled }
}

/** Fase 2: envia a fila da clínica até o prazo compartilhado. */
function sendClinic(
  admin: SupabaseClient,
  provider: WhatsAppProvider,
  conn: Conn,
  cfg: MessagingConfig,
  deadline: Date,
): Promise<ProcessResult> {
  return processQueue({
    clinicId: conn.clinic_id,
    cfg,
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
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Erro desconhecido'
}

export interface CycleSteps<C extends { clinic_id: string }, P extends { planned: number; cancelled: number }> {
  prepare(conn: C): Promise<P>
  send(conn: C, prepared: P): Promise<Pick<ProcessResult, 'sent' | 'failed' | 'skippedReason'>>
}

/**
 * Justiça entre clínicas: primeiro prepara todas (em sequência, barato), depois envia todas em paralelo
 * sob o mesmo prazo — uma clínica com fila grande não consome o ciclo das outras. Erro de uma clínica
 * não afeta as demais.
 */
export async function runClinicsFairly<C extends { clinic_id: string }, P extends { planned: number; cancelled: number }>(
  conns: C[],
  steps: CycleSteps<C, P>,
  deadline: Date,
  clock: () => number = Date.now,
): Promise<Record<string, ClinicCycleResult>> {
  const results: Record<string, ClinicCycleResult> = {}
  const ready: { conn: C; prepared: P }[] = []

  for (const conn of conns) {
    if (clock() >= deadline.getTime()) break
    try {
      ready.push({ conn, prepared: await steps.prepare(conn) })
    } catch (err) {
      const message = errorMessage(err)
      console.error('[cron] clinic', conn.clinic_id, message)
      results[conn.clinic_id] = { planned: 0, cancelled: 0, sent: 0, failed: 0, error: message }
    }
  }

  const settled = await Promise.allSettled(
    ready.map(({ conn, prepared }) =>
      clock() >= deadline.getTime() ? Promise.resolve(null) : steps.send(conn, prepared),
    ),
  )
  settled.forEach((s, i) => {
    const { conn, prepared } = ready[i]
    const base = { planned: prepared.planned, cancelled: prepared.cancelled, sent: 0, failed: 0 }
    if (s.status === 'rejected') {
      const message = errorMessage(s.reason)
      console.error('[cron] clinic', conn.clinic_id, message)
      results[conn.clinic_id] = { ...base, error: message }
    } else if (s.value === null) {
      results[conn.clinic_id] = { ...base, skippedReason: 'deadline' }
    } else {
      results[conn.clinic_id] = {
        ...base,
        sent: s.value.sent,
        failed: s.value.failed,
        ...(s.value.skippedReason ? { skippedReason: s.value.skippedReason } : {}),
      }
    }
  })
  return results
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

  return runClinicsFairly((data ?? []) as Conn[], {
    prepare: (conn) => prepareClinic(admin, conn, now),
    send: (conn, prepared) => sendClinic(admin, provider, conn, prepared.cfg, deadline),
  }, deadline)
}
