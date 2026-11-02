import { createClient } from '@supabase/supabase-js'

// Cliente com service role: ignora a RLS. Só usar em código de servidor
// (rotas de cron/webhook e tabelas sem policy, como whatsapp_connections).
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar definidas')
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
