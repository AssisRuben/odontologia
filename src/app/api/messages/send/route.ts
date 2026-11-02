import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getCurrentClinic } from '@/lib/auth/currentClinic'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendManual, type ManualDeps } from '@/lib/messaging/manual'
import { createSupabaseQueueRepo } from '@/lib/messaging/repo'
import { sendNow } from '@/lib/messaging/sendNow'
import { normalizeMessagingConfig } from '@/lib/messaging/config'
import { startOfClinicDay } from '@/lib/messaging/window'

export const dynamic = 'force-dynamic'

function check(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

// Envio manual a um paciente (ignora a janela de horário; respeita opt-out e limite diário).
export async function POST(req: NextRequest) {
  let current
  try {
    current = await getCurrentClinic()
  } catch (e) {
    console.error('[messages/send] falha ao identificar a clínica:', (e as Error).message)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }
  if (!current) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

  let json: { patient_id?: unknown; body?: unknown } | null = null
  try {
    json = await req.json()
  } catch {
    // corpo inválido cai na validação (422)
  }

  const admin = createAdminClient()
  const repo = createSupabaseQueueRepo(admin)
  const deps: ManualDeps = {
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

  try {
    const result = await sendManual(
      { clinicId: current.clinicId, patient_id: json?.patient_id, body: json?.body },
      deps,
    )
    return NextResponse.json(result.body, { status: result.status })
  } catch (e) {
    console.error('[messages/send] falha:', (e as Error).message)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }
}
