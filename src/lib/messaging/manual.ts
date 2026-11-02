import type { MessagingConfig } from './types'
import { normalizePhone } from './phone'

export const MAX_MANUAL_LENGTH = 4096

export interface ManualPatient {
  id: string
  whatsapp: string | null
  phone: string | null
  whatsapp_opt_out: boolean
}

export interface ManualRow {
  clinic_id: string
  patient_id: string
  type: 'manual'
  direction: 'out'
  phone: string
  body: string
  dedupe_key: null
}

export interface ManualDeps {
  findPatient(clinicId: string, patientId: string): Promise<ManualPatient | null>
  getConnection(clinicId: string): Promise<{ instance: string; token: string; status: string } | null>
  getConfig(clinicId: string): Promise<MessagingConfig>
  countSentToday(clinicId: string, cfg: MessagingConfig): Promise<number>
  /** Grava a linha 'sending', envia e marca sent/failed. */
  deliver(
    conn: { instance: string; token: string },
    row: ManualRow,
  ): Promise<{ ok: true; id: string } | { ok: false; id: string; error: string }>
}

export interface ManualResult {
  status: number
  body: { id: string } | { error: string }
}

const fail = (status: number, error: string): ManualResult => ({ status, body: { error } })

export async function sendManual(
  input: { clinicId: string; patient_id: unknown; body: unknown },
  deps: ManualDeps,
): Promise<ManualResult> {
  const { clinicId } = input
  if (typeof input.patient_id !== 'string' || !input.patient_id || typeof input.body !== 'string') {
    return fail(422, 'Texto vazio')
  }
  const text = input.body.trim()
  if (!text) return fail(422, 'Texto vazio')
  if (text.length > MAX_MANUAL_LENGTH) return fail(422, 'Texto muito longo')

  const patient = await deps.findPatient(clinicId, input.patient_id)
  if (!patient) return fail(404, 'Paciente não encontrado')
  if (patient.whatsapp_opt_out) return fail(422, 'Paciente optou por não receber WhatsApp')
  const phone = normalizePhone(patient.whatsapp) ?? normalizePhone(patient.phone)
  if (!phone) return fail(422, 'Paciente sem WhatsApp válido')

  const conn = await deps.getConnection(clinicId)
  if (!conn || conn.status !== 'connected') return fail(409, 'WhatsApp da clínica desconectado')

  const cfg = await deps.getConfig(clinicId)
  if ((await deps.countSentToday(clinicId, cfg)) >= cfg.daily_limit) {
    return fail(429, 'Limite diário de mensagens atingido')
  }

  const res = await deps.deliver(conn, {
    clinic_id: clinicId,
    patient_id: patient.id,
    type: 'manual',
    direction: 'out',
    phone,
    body: text,
    dedupe_key: null,
  })
  if (!res.ok) return fail(502, 'Falha ao enviar pelo WhatsApp')
  return { status: 200, body: { id: res.id } }
}
