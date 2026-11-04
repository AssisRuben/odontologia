import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualDeps } from './manual'
import { createSupabaseQueueRepo } from './repo'
import { sendNow } from './sendNow'
import { normalizeMessagingConfig } from './config'
import { startOfClinicDay } from './window'

function check(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

/** Dependências do envio manual (opt-out, limite diário e conexão são checados em sendManual). */
export function createManualDeps(admin: SupabaseClient): ManualDeps {
  const repo = createSupabaseQueueRepo(admin)
  return {
    async findPatient(clinicId, patientId) {
      const { data, error } = await admin
        .from('patients')
        .select('id, whatsapp, phone, whatsapp_opt_out')
        .eq('id', patientId)
        .eq('clinic_id', clinicId)
        .maybeSingle()
      // id que não é UUID (22P02) equivale a "não encontrado"
      if (error?.code === '22P02') return null
      check(error)
      return data
    },
    async getConnection(clinicId) {
      const { data, error } = await admin
        .from('whatsapp_connections')
        .select('instance, token, status')
        .eq('clinic_id', clinicId)
        .maybeSingle()
      check(error)
      return data
    },
    async getConfig(clinicId) {
      const { data, error } = await admin.from('clinics').select('messaging_config').eq('id', clinicId).single()
      check(error)
      return normalizeMessagingConfig(data!.messaging_config)
    },
    countSentToday: (clinicId, cfg) => repo.countSentSince(clinicId, startOfClinicDay(new Date(), cfg.timezone)),
    deliver: (conn, row) => sendNow(admin, conn, row),
  }
}
