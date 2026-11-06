import type { SupabaseClient } from '@supabase/supabase-js'
import { sendNow } from '@/lib/messaging/sendNow'
import type { CaixaConversation, PacienteDeps, ResponderDeps } from './caixa'

function check(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

export const CONV_FIELDS = 'id, phone, patient_id, handler, contact_name'

/** Busca a conversa filtrando por clínica; null se não existir nessa clínica. */
export async function loadClinicConversation(
  admin: SupabaseClient,
  clinicId: string,
  id: string,
): Promise<CaixaConversation | null> {
  const { data, error } = await admin
    .from('conversations')
    .select(CONV_FIELDS)
    .eq('id', id)
    .eq('clinic_id', clinicId)
    .maybeSingle()
  check(error)
  return (data as CaixaConversation | null) ?? null
}

export function createResponderDeps(admin: SupabaseClient): ResponderDeps {
  return {
    loadConversation: (clinicId, id) => loadClinicConversation(admin, clinicId, id),
    async getConnection(clinicId) {
      const { data, error } = await admin
        .from('whatsapp_connections')
        .select('instance, token, status')
        .eq('clinic_id', clinicId)
        .maybeSingle()
      check(error)
      return (data as { instance: string; token: string; status: string } | null) ?? null
    },
    send: (conn, row) => sendNow(admin, conn, row),
    async markAnswered(conversationId, takeOverReason) {
      const patch: Record<string, unknown> = { unread: false, last_message_at: new Date().toISOString() }
      if (takeOverReason) {
        patch.handler = 'human'
        patch.handoff_reason = takeOverReason
        patch.handler_since = new Date().toISOString()
      }
      const { error } = await admin.from('conversations').update(patch).eq('id', conversationId)
      check(error)
    },
  }
}

export function createPacienteDeps(admin: SupabaseClient): PacienteDeps {
  return {
    loadConversation: (clinicId, id) => loadClinicConversation(admin, clinicId, id),
    async createPatient(clinicId, name, phone) {
      const { data, error } = await admin
        .from('patients')
        .insert({ clinic_id: clinicId, name, phone, whatsapp: phone })
        .select('id')
        .single()
      check(error)
      return data!.id as string
    },
    async linkPatient(conversationId, patientId) {
      const { error } = await admin.from('conversations').update({ patient_id: patientId }).eq('id', conversationId)
      check(error)
    },
  }
}
