import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeWorkingHours } from './config'
import type { AgendaDeps } from './executar'

function check(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

const ERROS_RPC = ['HORARIO_OCUPADO', 'CONSULTA_INVALIDA'] as const

export function createAgendaDeps(admin: SupabaseClient): AgendaDeps {
  return {
    async carregar(clinicId, from, to) {
      const [profRes, apRes] = await Promise.all([
        admin.from('professionals').select('id, name, working_hours, whatsapp_booking').eq('clinic_id', clinicId).order('name'),
        admin
          .from('appointments')
          .select('professional_id, start_time, end_time')
          .eq('clinic_id', clinicId)
          .lt('start_time', to.toISOString())
          .gt('end_time', from.toISOString())
          .not('status', 'in', '(cancelled,no_show)'),
      ])
      check(profRes.error)
      check(apRes.error)
      const profs = (profRes.data ?? []) as { id: string; name: string; working_hours: unknown; whatsapp_booking: boolean | null }[]
      const aps = (apRes.data ?? []) as { professional_id: string; start_time: string; end_time: string }[]
      return {
        profissionais: profs.map((p) => ({
          id: p.id,
          nome: p.name,
          workingHours: normalizeWorkingHours(p.working_hours),
          whatsappBooking: p.whatsapp_booking === true,
        })),
        ocupados: aps.map((a) => ({ professional_id: a.professional_id, start: a.start_time, end: a.end_time })),
      }
    },

    async salvarEstado(conversationId, estado) {
      const { error } = await admin
        .from('conversations')
        .update({ offers: estado.offers, booking_draft: estado.booking_draft, searches: estado.searches })
        .eq('id', conversationId)
      check(error)
    },

    async criarPaciente(clinicId, nome, phone) {
      const { data, error } = await admin
        .from('patients')
        .insert({ clinic_id: clinicId, name: nome, phone, whatsapp: phone, source: 'whatsapp' })
        .select('id')
        .single()
      check(error)
      return (data as { id: string }).id
    },

    async ligarPaciente(conversationId, patientId) {
      const { error } = await admin.from('conversations').update({ patient_id: patientId }).eq('id', conversationId)
      check(error)
    },

    async contarFuturasWhatsapp(clinicId, patientId, now) {
      const { count, error } = await admin
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .eq('source', 'whatsapp')
        .gt('start_time', now.toISOString())
        .in('status', ['scheduled', 'confirmed'])
      check(error)
      return count ?? 0
    },

    async gravar(args) {
      const { data, error } = await admin.rpc('book_whatsapp_appointment', {
        p_clinic_id: args.clinicId,
        p_patient_id: args.patientId,
        p_professional_id: args.professionalId,
        p_start: args.start,
        p_end: args.end,
        p_procedure: args.procedure,
        p_replace_id: args.replaceId,
      })
      if (error) {
        const e = error as { code?: string; message: string }
        const erro = ERROS_RPC.find((m) => e.message?.includes(m))
        if (e.code === 'P0001' && erro) return { ok: false, erro }
        throw new Error(e.message)
      }
      return { ok: true, id: data as string }
    },

    async desmarcar(clinicId, patientId, appointmentId) {
      const { data, error } = await admin
        .from('appointments')
        .update({ status: 'cancelled' })
        .eq('id', appointmentId)
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .in('status', ['scheduled', 'confirmed'])
        .select('id')
      check(error)
      return ((data ?? []) as unknown[]).length > 0
    },
  }
}
