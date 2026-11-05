import type { SupabaseClient } from '@supabase/supabase-js'
import type { BudgetStatus, BudgetEvent, LostReason } from '@/types'
import type { FunnelRow } from './funil'
import type { PatientRow } from '@/lib/messaging/types'
import { sendManual } from '@/lib/messaging/manual'
import { createManualDeps } from '@/lib/messaging/manualDeps'
import { normalizeMessagingConfig } from '@/lib/messaging/config'
import type { LinkDeps } from './links'
import type { ApprovalDeps } from './aprovacao'
import type { SendDeps } from './envio'
import type { Snapshot } from './assinatura'
import type { PublicDeps } from './publico'

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
        .select('id, budget_id, clinic_id, revoked_at, locked_until, budgets(status, valid_until)')
        .eq('token', token)
        .maybeSingle()
      check(error)
      if (!data) return null
      const row = data as unknown as {
        id: string; budget_id: string; clinic_id: string; revoked_at: string | null
        locked_until: string | null; budgets: { status: BudgetStatus; valid_until: string | null } | { status: BudgetStatus; valid_until: string | null }[] | null
      }
      const b = Array.isArray(row.budgets) ? row.budgets[0] : row.budgets
      if (!b) return null
      let signedAt: string | null = null
      let signatureLinkId: string | null = null
      if (b.status === 'approved' || b.status === 'completed') {
        const sig = await admin.from('budget_signatures').select('signed_at, link_id').eq('budget_id', row.budget_id).eq('clinic_id', row.clinic_id).maybeSingle()
        check(sig.error)
        const sd = sig.data as { signed_at: string; link_id: string | null } | null
        signedAt = sd?.signed_at ?? null
        signatureLinkId = sd?.link_id ?? null
      }
      return {
        id: row.id, budget_id: row.budget_id, clinic_id: row.clinic_id, revoked_at: row.revoked_at,
        locked_until: row.locked_until, budget_status: b.status, valid_until: b.valid_until, signed_at: signedAt,
        signature_link_id: signatureLinkId,
      }
    },
    async registerFailed(linkId, clinicId) {
      const { data, error } = await admin.rpc('register_failed_attempt', { p_link_id: linkId, p_clinic_id: clinicId })
      check(error)
      return data === true
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
    async getActiveLink(budgetId, clinicId) {
      const { data, error } = await admin
        .from('budget_links')
        .select('id, token')
        .eq('budget_id', budgetId)
        .eq('clinic_id', clinicId)
        .is('revoked_at', null)
        .maybeSingle()
      if (checkId(error)) return null
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

export interface FunnelListRow {
  id: string
  patient: { id: string; name: string; phone: string | null }
  professional_name: string | null
  total: number
  approved_total: number
  charged: number
  sent_at: string | null
  viewed_at: string | null
  valid_until: string | null
  decided_at: string | null
  lost_reason: LostReason | null
  followup_at: string | null
  last_events: BudgetEvent[]
  approval_seen: boolean
}

export interface FunnelSource extends FunnelRow {
  list: FunnelListRow
  viewed_at: string | null
  followup_at: string | null
  link_created_at: string | null
}

const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

/** Orçamentos já enviados da clínica, com tudo que o funil e as abas precisam. */
export async function loadFunnelSources(admin: SupabaseClient, clinicId: string): Promise<FunnelSource[]> {
  const { data, error } = await admin
    .from('budgets')
    .select(
      'id, status, total, approved_total, sent_at, viewed_at, valid_until, decided_at, lost_reason, followup_at, approval_seen_at, professional_id, ' +
        'patients(id, name, phone), professionals(name), budget_links(created_at, revoked_at), payments(amount, status), ' +
        'budget_events(id, budget_id, clinic_id, type, outcome, reason, note, created_by, created_at)',
    )
    .eq('clinic_id', clinicId)
    .or('sent_at.not.is.null,decided_at.not.is.null')
  check(error)
  type P = { id: string; name: string; phone: string | null }
  type Raw = {
    id: string; status: BudgetStatus; total: number; approved_total: number | null; sent_at: string | null
    viewed_at: string | null; valid_until: string | null; decided_at: string | null; lost_reason: LostReason | null
    followup_at: string | null; approval_seen_at: string | null; professional_id: string | null
    patients: P | P[] | null
    professionals: { name: string } | { name: string }[] | null
    budget_links: { created_at: string; revoked_at: string | null }[] | null
    payments: { amount: number; status: string }[] | null
    budget_events: BudgetEvent[] | null
  }
  return ((data ?? []) as unknown as Raw[]).map((r) => {
    const patient = first(r.patients) ?? { id: '', name: '', phone: null }
    const profName = first(r.professionals)?.name ?? null
    const link = (r.budget_links ?? []).filter((l) => !l.revoked_at).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
    const charged = (r.payments ?? [])
      .filter((p) => p.status !== 'cancelled' && p.status !== 'refunded')
      .reduce((s, p) => s + Number(p.amount), 0)
    const events = [...(r.budget_events ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 3)
    const total = Number(r.total)
    const approved_total = Number(r.approved_total ?? 0)
    return {
      id: r.id, status: r.status, sent_at: r.sent_at, decided_at: r.decided_at, total, approved_total,
      professional_id: r.professional_id, professional_name: profName ?? '', lost_reason: r.lost_reason,
      viewed_at: r.viewed_at, followup_at: r.followup_at, link_created_at: link?.created_at ?? null,
      list: {
        id: r.id, patient, professional_name: profName, total, approved_total, charged,
        sent_at: r.sent_at, viewed_at: r.viewed_at, valid_until: r.valid_until, decided_at: r.decided_at,
        lost_reason: r.lost_reason, followup_at: r.followup_at, last_events: events,
        approval_seen: r.approval_seen_at !== null,
      },
    }
  })
}

/** Fuso da clínica e dias do lembrete de orçamento (null quando desligado). */
export async function loadReminderSettings(admin: SupabaseClient, clinicId: string): Promise<{ tz: string; reminderDays: number[] | null }> {
  const [c, s] = await Promise.all([
    admin.from('clinics').select('messaging_config').eq('id', clinicId).single(),
    admin.from('message_settings').select('enabled, config').eq('clinic_id', clinicId).eq('type', 'budget_reminder').maybeSingle(),
  ])
  check(c.error); check(s.error)
  const row = s.data as { enabled: boolean; config: { offset_days?: number[] } | null } | null
  const days = row?.enabled ? row.config?.offset_days : null
  return {
    tz: normalizeMessagingConfig((c.data as { messaging_config: unknown }).messaging_config).timezone,
    reminderDays: days && days.length > 0 ? days : null,
  }
}

/** Comprovante de assinatura do orçamento (da clínica); null se não houver. */
export async function loadSignature(admin: SupabaseClient, budgetId: string, clinicId: string) {
  const { data, error } = await admin
    .from('budget_signatures')
    .select('snapshot, document_hash, ip, user_agent, provider')
    .eq('budget_id', budgetId)
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (checkId(error)) return null
  return data as { snapshot: Snapshot; document_hash: string; ip: string | null; user_agent: string | null; provider: 'app' | 'reception' } | null
}


/** Dependências da página pública do paciente (sempre filtradas por clínica). */
export function createPublicDeps(admin: SupabaseClient): PublicDeps {
  return {
    ...createLinkDeps(admin),
    async loadOpen(budgetId, clinicId) {
      const { data, error } = await admin
        .from('budgets')
        .select('id, created_at, valid_until, professionals(name), budget_items(id, procedure, tooth, quantity, unit_price)')
        .eq('id', budgetId)
        .eq('clinic_id', clinicId)
        .maybeSingle()
      if (checkId(error) || !data) return null
      const row = data as unknown as {
        id: string; created_at: string; valid_until: string | null
        professionals: { name: string } | { name: string }[] | null
        budget_items: { id: string; procedure: string; tooth: string | null; quantity: number; unit_price: number }[]
      }
      const clinic = await admin.from('clinics').select('name').eq('id', clinicId).single()
      check(clinic.error)
      return {
        // clinics ainda não tem coluna de logotipo
        clinic: { name: (clinic.data as { name: string }).name, logoUrl: null },
        professional: first(row.professionals)?.name ?? null,
        number: row.id.slice(0, 8).toUpperCase(),
        createdAt: row.created_at,
        validUntil: row.valid_until,
        items: row.budget_items.map((i) => ({
          id: i.id, procedure: i.procedure, tooth: i.tooth, quantity: i.quantity, unitPrice: Number(i.unit_price),
        })),
      }
    },
    async patientCpfs(budgetId, clinicId) {
      const { data, error } = await admin
        .from('budgets')
        .select('patients(cpf, payer_cpf)')
        .eq('id', budgetId)
        .eq('clinic_id', clinicId)
        .maybeSingle()
      if (checkId(error) || !data) return null
      const p = first((data as unknown as { patients: { cpf: string | null; payer_cpf: string | null } | { cpf: string | null; payer_cpf: string | null }[] | null }).patients)
      return p ? { cpf: p.cpf, payerCpf: p.payer_cpf } : null
    },
    async bumpView(linkId, clinicId) {
      const cur = await admin.from('budget_links').select('view_count').eq('id', linkId).eq('clinic_id', clinicId).single()
      check(cur.error)
      const before = (cur.data as { view_count: number }).view_count ?? 0
      const { error } = await admin.from('budget_links').update({ view_count: before + 1 }).eq('id', linkId).eq('clinic_id', clinicId)
      check(error)
      return before
    },
    async markViewed(budgetId, clinicId, now) {
      const { error } = await admin
        .from('budgets')
        .update({ viewed_at: now.toISOString() })
        .eq('id', budgetId)
        .eq('clinic_id', clinicId)
        .is('viewed_at', null)
      check(error)
    },
    async addViewedEvent(budgetId, clinicId) {
      const { error } = await admin.from('budget_events').insert({ budget_id: budgetId, clinic_id: clinicId, type: 'viewed' })
      check(error)
    },
  }
}
