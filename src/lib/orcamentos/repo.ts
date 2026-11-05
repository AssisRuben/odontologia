import type { SupabaseClient } from '@supabase/supabase-js'
import type { BudgetStatus } from '@/types'
import type { PatientRow } from '@/lib/messaging/types'
import { sendManual } from '@/lib/messaging/manual'
import { createManualDeps } from '@/lib/messaging/manualDeps'
import { normalizeMessagingConfig } from '@/lib/messaging/config'
import type { LinkDeps } from './links'
import type { ApprovalDeps } from './aprovacao'
import type { SendDeps } from './envio'

function check(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

/** Erro de UUID inválido (22P02) equivale a "não encontrado". */
function checkId(error: { message: string; code?: string } | null): boolean {
  if (error?.code === '22P02') return true
  check(error)
  return false
}

type Rpc = 'ok' | 'already_decided' | 'not_found' | 'not_sendable'

async function rpc(admin: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<Rpc> {
  const { data, error } = await admin.rpc(fn, args)
  check(error)
  return data as Rpc
}

export function createLinkDeps(admin: SupabaseClient): LinkDeps {
  return {
    async findByToken(token) {
      const { data, error } = await admin
        .from('budget_links')
        .select('id, budget_id, clinic_id, revoked_at, locked_until, budgets(status)')
        .eq('token', token)
        .maybeSingle()
      check(error)
      if (!data) return null
      const row = data as unknown as {
        id: string; budget_id: string; clinic_id: string; revoked_at: string | null
        locked_until: string | null; budgets: { status: BudgetStatus } | { status: BudgetStatus }[] | null
      }
      const b = Array.isArray(row.budgets) ? row.budgets[0] : row.budgets
      if (!b) return null
      let signedAt: string | null = null
      if (b.status === 'approved' || b.status === 'completed') {
        const sig = await admin.from('budget_signatures').select('signed_at').eq('budget_id', row.budget_id).maybeSingle()
        check(sig.error)
        signedAt = (sig.data as { signed_at: string } | null)?.signed_at ?? null
      }
      return {
        id: row.id, budget_id: row.budget_id, clinic_id: row.clinic_id, revoked_at: row.revoked_at,
        locked_until: row.locked_until, budget_status: b.status, signed_at: signedAt,
      }
    },
    async incrementFailed(linkId) {
      const cur = await admin.from('budget_links').select('failed_attempts').eq('id', linkId).single()
      check(cur.error)
      const next = ((cur.data as { failed_attempts: number }).failed_attempts ?? 0) + 1
      const { error } = await admin.from('budget_links').update({ failed_attempts: next }).eq('id', linkId)
      check(error)
      return next
    },
    async lock(linkId, until) {
      const { error } = await admin
        .from('budget_links')
        .update({ locked_until: until.toISOString(), failed_attempts: 0 })
        .eq('id', linkId)
      check(error)
    },
  }
}

export function createApprovalDeps(admin: SupabaseClient): ApprovalDeps {
  return {
    async loadForApproval(budgetId, clinicId) {
      const { data, error } = await admin
        .from('budgets')
        .select('id, created_at, valid_until, patients(name), professionals(name), budget_items(id, procedure, tooth, quantity, unit_price)')
        .eq('id', budgetId)
        .eq('clinic_id', clinicId)
        .maybeSingle()
      if (checkId(error) || !data) return null
      const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)
      const row = data as unknown as {
        id: string; created_at: string; valid_until: string | null
        patients: { name: string } | { name: string }[] | null
        professionals: { name: string } | { name: string }[] | null
        budget_items: { id: string; procedure: string; tooth: string | null; quantity: number; unit_price: number }[]
      }
      const clinic = await admin.from('clinics').select('name').eq('id', clinicId).single()
      check(clinic.error)
      return {
        budget: { id: row.id, created_at: row.created_at, valid_until: row.valid_until },
        clinicName: (clinic.data as { name: string }).name,
        patientName: one(row.patients)?.name ?? '',
        professionalName: one(row.professionals)?.name ?? null,
        items: row.budget_items.map((i) => ({ ...i, unit_price: Number(i.unit_price) })),
      }
    },
    async actorName(clinicId, actorId) {
      const { data, error } = await admin
        .from('professionals')
        .select('name')
        .eq('user_id', actorId)
        .eq('clinic_id', clinicId)
        .maybeSingle()
      check(error)
      return (data as { name: string } | null)?.name ?? null
    },
    rpcApprove: (budgetId, linkId, itemIds, approvedTotal, signature, actorId) =>
      rpc(admin, 'approve_budget', {
        p_budget_id: budgetId, p_link_id: linkId, p_item_ids: itemIds,
        p_approved_total: approvedTotal, p_signature: signature, p_actor: actorId,
      }) as Promise<'ok' | 'already_decided' | 'not_found'>,
    rpcReject: (budgetId, linkId, reason, note, actorId, status) =>
      rpc(admin, 'reject_budget', {
        p_budget_id: budgetId, p_link_id: linkId, p_reason: reason, p_note: note,
        p_actor: actorId, p_status: status,
      }) as Promise<'ok' | 'already_decided' | 'not_found'>,
    async listSent() {
      const { data, error } = await admin.from('budgets').select('id, status, valid_until').eq('status', 'sent').not('valid_until', 'is', null)
      check(error)
      return (data ?? []) as { id: string; status: string; valid_until: string | null }[]
    },
  }
}

export function createSendDeps(admin: SupabaseClient): SendDeps {
  const manual = createManualDeps(admin)
  return {
    async loadBudget(budgetId, clinicId) {
      const { data, error } = await admin
        .from('budgets')
        .select('id, patient_id, status, total, budget_items(id)')
        .eq('id', budgetId)
        .eq('clinic_id', clinicId)
        .maybeSingle()
      if (checkId(error) || !data) return null
      const r = data as unknown as { id: string; patient_id: string; status: BudgetStatus; total: number; budget_items: unknown[] }
      return { id: r.id, patient_id: r.patient_id, status: r.status, total: Number(r.total), itemCount: r.budget_items.length }
    },
    async getValidityDays(clinicId) {
      const { data, error } = await admin.from('clinics').select('budget_validity_days').eq('id', clinicId).single()
      check(error)
      return (data as { budget_validity_days: number }).budget_validity_days
    },
    async getActiveLink(budgetId) {
      const { data, error } = await admin
        .from('budget_links')
        .select('id, token')
        .eq('budget_id', budgetId)
        .is('revoked_at', null)
        .maybeSingle()
      check(error)
      return (data as { id: string; token: string } | null) ?? null
    },
    rpcSend: (budgetId, token, validityDays, actorId) =>
      rpc(admin, 'send_budget', {
        p_budget_id: budgetId, p_token: token, p_validity_days: validityDays, p_actor: actorId,
      }) as Promise<'ok' | 'not_found' | 'not_sendable'>,
    async insertResent(budgetId, clinicId, actorId) {
      const { error } = await admin
        .from('budget_events')
        .insert({ budget_id: budgetId, clinic_id: clinicId, type: 'resent', created_by: actorId })
      check(error)
    },
    async loadMessageContext(clinicId, budgetId, patientId) {
      const [p, c, b, s] = await Promise.all([
        admin.from('patients').select('id, name, phone, whatsapp, birthdate, whatsapp_opt_out').eq('id', patientId).eq('clinic_id', clinicId).maybeSingle(),
        admin.from('clinics').select('name, messaging_config').eq('id', clinicId).single(),
        admin.from('budgets').select('total, valid_until').eq('id', budgetId).eq('clinic_id', clinicId).single(),
        admin.from('message_settings').select('template').eq('clinic_id', clinicId).eq('type', 'budget').maybeSingle(),
      ])
      check(p.error); check(c.error); check(b.error); check(s.error)
      if (!p.data) return null
      const clinic = c.data as { name: string; messaging_config: unknown }
      const bud = b.data as { total: number; valid_until: string | null }
      return {
        patient: p.data as PatientRow,
        clinicName: clinic.name,
        tz: normalizeMessagingConfig(clinic.messaging_config).timezone,
        template: (s.data as { template: string } | null)?.template || null,
        total: Number(bud.total),
        valid_until: bud.valid_until,
      }
    },
    sendMessage: (input) => sendManual(input, manual),
  }
}
