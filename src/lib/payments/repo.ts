import type { SupabaseClient } from '@supabase/supabase-js'
import { defaultRandomHex, type ConnectionDeps, type StoredConnection } from './connection'
import { AsaasProvider } from './asaas'
import { webhookUrl } from './index'

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
