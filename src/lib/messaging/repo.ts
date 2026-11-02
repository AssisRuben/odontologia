import type { SupabaseClient } from '@supabase/supabase-js'

export interface QueuedMessage {
  id: string
  phone: string
  body: string
  attempts: number
}

export interface QueueRepo {
  releaseStuck(clinicId: string, olderThan: Date): Promise<void>
  listDue(clinicId: string, now: Date, limit: number): Promise<QueuedMessage[]>
  /** queued → sending; false se outro processo pegou. */
  lock(id: string): Promise<boolean>
  markSent(id: string, providerMessageId: string, at: Date): Promise<void>
  markFailed(id: string, error: string): Promise<void>
  requeue(id: string, attempts: number, at: Date, error: string): Promise<void>
  countSentSince(clinicId: string, since: Date): Promise<number>
}

function check(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

export function createSupabaseQueueRepo(admin: SupabaseClient): QueueRepo {
  return {
    async releaseStuck(clinicId, olderThan) {
      const { error } = await admin
        .from('messages')
        .update({ status: 'queued' })
        .eq('clinic_id', clinicId)
        .eq('status', 'sending')
        .lt('scheduled_for', olderThan.toISOString())
      check(error)
    },

    async listDue(clinicId, now, limit) {
      const iso = now.toISOString()
      const { data, error } = await admin
        .from('messages')
        .select('id, phone, body, attempts')
        .eq('clinic_id', clinicId)
        .eq('direction', 'out')
        .eq('status', 'queued')
        .lte('scheduled_for', iso)
        .or(`expires_at.is.null,expires_at.gt.${iso}`)
        .order('scheduled_for', { ascending: true })
        .limit(limit)
      check(error)
      return (data ?? []) as QueuedMessage[]
    },

    async lock(id) {
      const { data, error } = await admin
        .from('messages')
        .update({ status: 'sending', scheduled_for: new Date().toISOString() })
        .eq('id', id)
        .eq('status', 'queued')
        .select('id')
      check(error)
      return (data?.length ?? 0) === 1
    },

    async markSent(id, providerMessageId, at) {
      const { error } = await admin
        .from('messages')
        .update({ status: 'sent', provider_message_id: providerMessageId, sent_at: at.toISOString(), error: null })
        .eq('id', id)
      check(error)
    },

    async markFailed(id, errorText) {
      const { error } = await admin.from('messages').update({ status: 'failed', error: errorText }).eq('id', id)
      check(error)
    },

    async requeue(id, attempts, at, errorText) {
      const { error } = await admin
        .from('messages')
        .update({ status: 'queued', attempts, scheduled_for: at.toISOString(), error: errorText })
        .eq('id', id)
      check(error)
    },

    async countSentSince(clinicId, since) {
      const { count, error } = await admin
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('direction', 'out')
        .eq('status', 'sent')
        .gte('sent_at', since.toISOString())
      check(error)
      return count ?? 0
    },
  }
}
