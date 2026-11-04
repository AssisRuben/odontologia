import type { SupabaseClient } from '@supabase/supabase-js'
import { defaultRandomHex, type ConnectionDeps, type StoredConnection } from './connection'
import { AsaasProvider } from './asaas'
import { getProviderForClinic, webhookUrl } from './index'
import type { ChargeDeps, ChargePatient } from './charges'
import type { ActionDeps } from './actions'
import type { LocalStatus } from './status'
import { fromCents, toCents } from './money'
import { sendPaymentLink } from './notify'
import { normalizeMessagingConfig } from '@/lib/messaging/config'
import { todayYmd } from '@/lib/messaging/time'

function check(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

/** Marca a conexão como "chave inválida" (o Asaas recusou a chave). */
export async function markInvalidKey(admin: SupabaseClient, clinicId: string): Promise<void> {
  const { error } = await admin
    .from('payment_connections')
    .update({ status: 'invalid_key', updated_at: new Date().toISOString() })
    .eq('clinic_id', clinicId)
  check(error)
}

/** Linha pública da conexão (sem api_key e sem webhook_token). */
export async function getPublicConnection(admin: SupabaseClient, clinicId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin
    .from('payment_connections')
    .select(
      'clinic_id, environment, api_key_last4, account_name, status, fine_percent, interest_percent_month, nfse_auto, nfse_description, nfse_service_code, nfse_iss_rate',
    )
    .eq('clinic_id', clinicId)
    .maybeSingle()
  check(error)
  return data as Record<string, unknown> | null
}

export function createSupabaseConnectionDeps(admin: SupabaseClient): ConnectionDeps {
  return {
    makeProvider: (apiKey, environment) => new AsaasProvider({ apiKey, environment }),
    webhookUrl,
    randomHex: defaultRandomHex,
    async getStored(clinicId): Promise<StoredConnection | null> {
      const { data, error } = await admin
        .from('payment_connections')
        .select('api_key, environment, webhook_id')
        .eq('clinic_id', clinicId)
        .maybeSingle()
      check(error)
      return data as StoredConnection | null
    },
    async saveConnection(row) {
      const { error } = await admin.from('payment_connections').upsert(row, { onConflict: 'clinic_id' })
      check(error)
    },
    async deleteConnection(clinicId) {
      const { error } = await admin.from('payment_connections').delete().eq('clinic_id', clinicId)
      check(error)
    },
    async clearCustomerCache(clinicId) {
      const { error } = await admin.from('payment_customers').delete().eq('clinic_id', clinicId)
      check(error)
    },
    async updateConnection(clinicId, patch) {
      const { data, error } = await admin
        .from('payment_connections')
        .update(patch)
        .eq('clinic_id', clinicId)
        .select('clinic_id')
      check(error)
      return (data?.length ?? 0) > 0
    },
  }
}

/** Dependências de criação de cobrança sobre o Supabase (service role). */
export function createChargeDeps(admin: SupabaseClient): ChargeDeps {
  return {
    async getPatient(clinicId, patientId) {
      const { data, error } = await admin
        .from('patients')
        .select('id, name, cpf, phone, whatsapp, email')
        .eq('id', patientId)
        .eq('clinic_id', clinicId)
        .maybeSingle()
      if (error?.code === '22P02') return null
      check(error)
      return data as ChargePatient | null
    },
    async budgetBelongsToPatient(clinicId, patientId, budgetId) {
      const { data, error } = await admin
        .from('budgets')
        .select('id')
        .eq('id', budgetId)
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .maybeSingle()
      if (error?.code === '22P02') return false
      check(error)
      return !!data
    },
    async savePatientCpf(clinicId, patientId, cpf) {
      const { error } = await admin.from('patients').update({ cpf }).eq('id', patientId).eq('clinic_id', clinicId)
      check(error)
    },
    getConnection: (clinicId) => getProviderForClinic(admin, clinicId),
    async getCustomerId(clinicId, patientId) {
      const { data, error } = await admin
        .from('payment_customers')
        .select('provider_customer_id')
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .maybeSingle()
      check(error)
      return (data as { provider_customer_id: string } | null)?.provider_customer_id ?? null
    },
    async saveCustomerId(clinicId, patientId, customerId) {
      const { error } = await admin
        .from('payment_customers')
        .upsert({ clinic_id: clinicId, patient_id: patientId, provider_customer_id: customerId }, { onConflict: 'clinic_id,patient_id' })
      check(error)
    },
    async findRecentDuplicate(clinicId, patientId, amountCents, description, since) {
      const { data, error } = await admin
        .from('payments')
        .select('amount, charge_group_id')
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .eq('description', description)
        .not('charge_group_id', 'is', null)
        .gte('created_at', since.toISOString())
      check(error)
      const totals = new Map<string, number>()
      for (const r of (data ?? []) as { amount: number | string; charge_group_id: string }[]) {
        totals.set(r.charge_group_id, (totals.get(r.charge_group_id) ?? 0) + toCents(Number(r.amount)))
      }
      return [...totals.values()].some((t) => t === amountCents)
    },
    async insertCreatingRows(rows) {
      const { data, error } = await admin
        .from('payments')
        .insert(
          rows.map((r) => ({
            clinic_id: r.clinicId,
            patient_id: r.patientId,
            budget_id: r.budgetId,
            charge_group_id: r.groupId,
            charge_kind: r.kind,
            installment_number: r.installmentNumber,
            installment_count: r.installmentCount,
            amount: fromCents(r.amountCents),
            due_date: r.dueDate,
            description: r.description,
            payment_method: r.paymentMethod,
            status: 'pending',
            provider_state: 'creating',
          })),
        )
        .select('id, installment_number')
      check(error)
      const list = (data ?? []) as { id: string; installment_number: number | null }[]
      if (list.length !== rows.length) throw new Error('Falha ao gravar as parcelas')
      return list.sort((a, b) => (a.installment_number ?? 0) - (b.installment_number ?? 0)).map((r) => r.id)
    },
    async linkRows(clinicId, groupId, charges) {
      const { data, error } = await admin
        .from('payments')
        .select('id, installment_number')
        .eq('charge_group_id', groupId)
        .eq('clinic_id', clinicId)
      check(error)
      const rows = ((data ?? []) as { id: string; installment_number: number | null }[]).sort(
        (a, b) => (a.installment_number ?? 0) - (b.installment_number ?? 0),
      )
      if (rows.length !== charges.length) throw new Error('Parcelas do Asaas não conferem com as gravadas')
      const ordered = [...charges].sort((a, b) => (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0))
      for (let i = 0; i < rows.length; i++) {
        const c = ordered[i]
        const { error: upErr } = await admin
          .from('payments')
          .update({
            provider_charge_id: c.id,
            provider_installment_id: c.installmentId,
            invoice_url: c.invoiceUrl,
            due_date: c.dueDate,
            amount: fromCents(c.valueCents),
            provider_state: 'active',
            updated_at: new Date().toISOString(),
          })
          .eq('id', rows[i].id)
          .eq('clinic_id', clinicId)
        check(upErr)
      }
    },
    async deleteRows(clinicId, groupId) {
      const { error } = await admin.from('payments').delete().eq('clinic_id', clinicId).eq('charge_group_id', groupId).eq('provider_state', 'creating')
      check(error)
    },
    markInvalidKey: (clinicId) => markInvalidKey(admin, clinicId),
    sendLink: (clinicId, paymentId) => sendPaymentLink(admin, clinicId, paymentId),
    async today(clinicId, now) {
      const { data, error } = await admin.from('clinics').select('messaging_config').eq('id', clinicId).single()
      check(error)
      return todayYmd(now, normalizeMessagingConfig((data as { messaging_config: unknown }).messaging_config).timezone)
    },
  }
}

export function createActionDeps(admin: SupabaseClient): ActionDeps {
  return {
    async getPayment(clinicId, paymentId) {
      const { data, error } = await admin
        .from('payments')
        .select('id, status, due_date, amount, paid_at, net_amount, provider_charge_id, provider_installment_id, provider_state, charge_group_id')
        .eq('id', paymentId)
        .eq('clinic_id', clinicId)
        .maybeSingle()
      if (error?.code === '22P02') return null
      check(error)
      if (!data) return null
      const r = data as {
        id: string; status: LocalStatus; due_date: string | null; amount: number | string; paid_at: string | null
        net_amount: number | string | null; provider_charge_id: string | null; provider_installment_id: string | null
        provider_state: 'creating' | 'active' | null; charge_group_id: string | null
      }
      const { count, error: invErr } = await admin
        .from('fiscal_invoices')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('payment_id', paymentId)
        .eq('status', 'authorized')
      check(invErr)
      return {
        id: r.id,
        status: r.status,
        dueDate: r.due_date,
        amountCents: toCents(Number(r.amount)),
        paidAt: r.paid_at ? r.paid_at.slice(0, 10) : null,
        netAmountCents: r.net_amount === null ? null : toCents(Number(r.net_amount)),
        providerChargeId: r.provider_charge_id,
        providerInstallmentId: r.provider_installment_id,
        providerState: r.provider_state,
        chargeGroupId: r.charge_group_id,
        hasAuthorizedInvoice: (count ?? 0) > 0,
      }
    },
    getConnection: (clinicId) => getProviderForClinic(admin, clinicId),
    async listUnpaidInGroup(clinicId, groupId) {
      const { data, error } = await admin
        .from('payments')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('charge_group_id', groupId)
        .in('status', ['pending', 'overdue'])
      check(error)
      return ((data ?? []) as { id: string }[]).map((r) => r.id)
    },
    async updateRows(clinicId, ids, patch) {
      const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (patch.status !== undefined) row.status = patch.status
      if (patch.due_date !== undefined) row.due_date = patch.due_date
      // Meio-dia UTC mantém o dia correto no fuso de São Paulo.
      if (patch.paid_at !== undefined) row.paid_at = patch.paid_at === null ? null : `${patch.paid_at}T12:00:00Z`
      if (patch.payment_method !== undefined) row.payment_method = patch.payment_method
      if (patch.net_amount_cents !== undefined) row.net_amount = patch.net_amount_cents === null ? null : fromCents(patch.net_amount_cents)
      if (patch.amount_cents !== undefined) row.amount = fromCents(patch.amount_cents)
      const { error } = await admin.from('payments').update(row).eq('clinic_id', clinicId).in('id', ids)
      check(error)
    },
    markInvalidKey: (clinicId) => markInvalidKey(admin, clinicId),
    async today(clinicId, now) {
      const { data, error } = await admin.from('clinics').select('messaging_config').eq('id', clinicId).single()
      check(error)
      return todayYmd(now, normalizeMessagingConfig((data as { messaging_config: unknown }).messaging_config).timezone)
    },
  }
}
