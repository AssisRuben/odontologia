import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiTier } from '@/types'
import type { AiDeps } from './conexao'
import { makeAiClient } from './openai'
import type { UsageRow } from './uso'
import { fetchAllPages } from '@/lib/payments/repo'

function check(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

export function createAiDeps(admin: SupabaseClient): AiDeps {
  return {
    async getStored(clinicId) {
      const { data, error } = await admin
        .from('ai_connections')
        .select('api_key, api_key_last4, model_tier')
        .eq('clinic_id', clinicId)
        .maybeSingle()
      check(error)
      return data ? (data as { api_key: string; api_key_last4: string; model_tier: AiTier }) : null
    },
    async save(row) {
      const { error } = await admin.from('ai_connections').upsert(row, { onConflict: 'clinic_id' })
      check(error)
    },
    async remove(clinicId) {
      const { error } = await admin.from('ai_connections').delete().eq('clinic_id', clinicId)
      check(error)
    },
    async listUsage(clinicId, fromIso) {
      return fetchAllPages<UsageRow>(async (from, to) => {
        const { data, error } = await admin
          .from('ai_usage')
          .select('kind, model, audio_seconds, input_tokens, output_tokens, ok')
          .eq('clinic_id', clinicId)
          .gte('created_at', fromIso)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
        check(error)
        return (data ?? []) as UsageRow[]
      })
    },
    makeClient: apiKey => makeAiClient(apiKey),
  }
}

/** Registra o uso; falha só gera log, nunca derruba a rota. */
export async function recordUsage(
  admin: SupabaseClient,
  clinicId: string,
  userId: string | null,
  row: UsageRow,
): Promise<void> {
  try {
    const { error } = await admin.from('ai_usage').insert({ clinic_id: clinicId, user_id: userId, ...row })
    if (error) console.error('[ia/uso] falha ao registrar uso:', error.message)
  } catch (e) {
    console.error('[ia/uso] falha ao registrar uso:', (e as Error).message)
  }
}
