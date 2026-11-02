import type { SupabaseClient } from '@supabase/supabase-js'
import { getProvider } from '@/lib/whatsapp'

function check(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

export type SendNowResult = { ok: true; id: string } | { ok: false; id: string; error: string }

/**
 * Envio imediato: grava a linha 'sending', chama o provedor e marca 'sent'/'failed'.
 * Só erro do sendText marca 'failed'; se gravar 'sent' falhar (mensagem já entregue), propaga.
 */
export async function sendNow(
  admin: SupabaseClient,
  conn: { instance: string; token: string },
  row: { phone: string; body: string },
): Promise<SendNowResult> {
  const { data: inserted, error: insErr } = await admin
    .from('messages')
    .insert({ ...row, status: 'sending', attempts: 1 })
    .select('id')
    .single()
  check(insErr)
  const id = inserted!.id as string
  let providerMessageId: string
  try {
    ;({ providerMessageId } = await getProvider().sendText(conn.instance, conn.token, row.phone, row.body))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'erro'
    const { error } = await admin.from('messages').update({ status: 'failed', error: message }).eq('id', id)
    check(error)
    return { ok: false, id, error: message }
  }
  // Já entregue: se gravar 'sent' falhar, propaga (não marcar como failed uma mensagem enviada).
  const { error } = await admin
    .from('messages')
    .update({ status: 'sent', sent_at: new Date().toISOString(), provider_message_id: providerMessageId })
    .eq('id', id)
  check(error)
  return { ok: true, id }
}
