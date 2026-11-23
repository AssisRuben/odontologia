import type { SupabaseClient } from '@supabase/supabase-js'

/** Orçamentos aprovados nos últimos 30 dias que a recepção ainda não viu (selo do menu). Ignora o histórico importado. */
export async function contarAprovadosNaoVistos(supabase: SupabaseClient, clinicId: string, agora: Date = new Date()): Promise<number> {
  const since = new Date(agora.getTime() - 30 * 86400000).toISOString()
  const { count } = await supabase.from('budgets')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId).eq('status', 'approved')
    .is('approval_seen_at', null).is('imported_from', null).gte('decided_at', since)
  return count ?? 0
}
