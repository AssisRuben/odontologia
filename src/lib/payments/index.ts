import type { SupabaseClient } from '@supabase/supabase-js'
import { AsaasProvider } from './asaas'
import type { PaymentProvider } from './provider'

export * from './provider'
export { AsaasProvider, ASAAS_WEBHOOK_EVENTS } from './asaas'

/** Linha de payment_connections sem os segredos (api_key e webhook_token). */
export type PaymentConnection = {
  clinic_id: string
  provider: string
  environment: 'sandbox' | 'production'
  api_key_last4: string
  account_name: string | null
  webhook_id: string | null
  status: 'connected' | 'invalid_key'
  fine_percent: number
  interest_percent_month: number
  nfse_auto: boolean
  nfse_description: string
  nfse_service_code: string
  nfse_iss_rate: number | null
  created_at: string
  updated_at: string
}

/** URL pública que o Asaas chama: ASAAS_WEBHOOK_BASE_URL (túnel) ou APP_URL. */
export function webhookUrl(): string {
  const base = process.env.ASAAS_WEBHOOK_BASE_URL || process.env.APP_URL
  if (!base) throw new Error('APP_URL (ou ASAAS_WEBHOOK_BASE_URL) precisa estar definida')
  return `${base.replace(/\/+$/, '')}/api/webhooks/asaas`
}

/** Carrega a conexão da clínica (service role) e monta o provedor; null se não houver conexão. */
export async function getProviderForClinic(
  admin: SupabaseClient,
  clinicId: string,
): Promise<{ provider: PaymentProvider; connection: PaymentConnection } | null> {
  const { data, error } = await admin.from('payment_connections').select('*').eq('clinic_id', clinicId).maybeSingle()
  if (error) throw new Error(`Falha ao ler a conexão de pagamentos: ${error.message}`)
  if (!data) return null
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { api_key, webhook_token, ...connection } = data as Record<string, unknown>
  if (typeof api_key !== 'string' || !api_key) throw new Error('Conexão Asaas sem chave')
  const provider = new AsaasProvider({
    apiKey: api_key,
    environment: connection.environment === 'production' ? 'production' : 'sandbox',
  })
  return { provider, connection: connection as unknown as PaymentConnection }
}
