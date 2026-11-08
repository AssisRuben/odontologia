// Acesso ao banco (service role) para guias e itens; toda consulta filtra por clinic_id.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { GuideStatus, GuideTooth } from '@/types'
import type { ItemNovo, RespostaGuia, TratamentoParaGuia } from './guias'

type Erro = { message: string; code?: string }

function lancar(error: Erro): never {
  throw { code: error.code, message: error.message }
}

type LinhaTratamento = {
  id: string
  patient_id: string
  insurance_plan_id: string | null
  status: TratamentoParaGuia['status']
  value: number | string | null
  treatment_teeth: { tooth_number: number; faces: string[] | null }[] | null
  insurance_plan_procedures: { code: string; name: string; requires_authorization: boolean; active: boolean; insurance_plan_id: string } | null
}

export function createConveniosRepo(admin: SupabaseClient) {
  return {
    async tratamentosParaGuia(clinicId: string, treatmentIds: string[]): Promise<TratamentoParaGuia[]> {
      const { data, error } = await admin
        .from('treatments')
        .select(
          'id, patient_id, insurance_plan_id, status, value, treatment_teeth(tooth_number, faces), insurance_plan_procedures(code, name, requires_authorization, active, insurance_plan_id)',
        )
        .eq('clinic_id', clinicId)
        .in('id', treatmentIds)
      if (error) throw new Error(error.message)
      const linhas = (data ?? []) as unknown as LinhaTratamento[]

      const { data: ativos, error: e2 } = await admin
        .from('insurance_guide_items')
        .select('treatment_id')
        .eq('clinic_id', clinicId)
        .eq('active', true)
        .in('treatment_id', treatmentIds)
      if (e2) throw new Error(e2.message)
      const emGuia = new Set((ativos ?? []).map((r: { treatment_id: string }) => r.treatment_id))

      return linhas.map((t) => {
        const p = t.insurance_plan_procedures
        const teeth: GuideTooth[] = (t.treatment_teeth ?? []).map((d) => ({ tooth: d.tooth_number, faces: d.faces ?? [] }))
        return {
          id: t.id,
          patient_id: t.patient_id,
          insurance_plan_id: t.insurance_plan_id,
          status: t.status,
          value: Number(t.value ?? 0),
          teeth,
          procedimento:
            p && p.active && p.insurance_plan_id === t.insurance_plan_id ? { code: p.code, name: p.name, requires_authorization: p.requires_authorization } : null,
          emGuiaAtiva: emGuia.has(t.id),
        }
      })
    },

    async paciente(clinicId: string, patientId: string): Promise<{ insurance_card: string | null } | null> {
      const { data, error } = await admin
        .from('patients')
        .select('insurance_card')
        .eq('id', patientId)
        .eq('clinic_id', clinicId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return data as { insurance_card: string | null } | null
    },

    async convenioExiste(clinicId: string, planId: string): Promise<boolean> {
      const { data, error } = await admin
        .from('insurance_plans')
        .select('id')
        .eq('id', planId)
        .eq('clinic_id', clinicId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return !!data
    },

    async profissionalExiste(clinicId: string, professionalId: string): Promise<boolean> {
      const { data, error } = await admin
        .from('professionals')
        .select('id')
        .eq('id', professionalId)
        .eq('clinic_id', clinicId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return !!data
    },

    async criarGuia(
      clinicId: string,
      args: {
        patientId: string
        planId: string
        professionalId: string | null
        card: string | null
        status: 'aguardando' | 'liberada'
        itens: ItemNovo[]
      },
    ): Promise<string> {
      const { data, error } = await admin.rpc('create_insurance_guide', {
        p_clinic_id: clinicId,
        p_patient_id: args.patientId,
        p_plan_id: args.planId,
        p_professional_id: args.professionalId,
        p_card: args.card,
        p_status: args.status,
        p_items: args.itens,
      })
      if (error) lancar(error)
      return data as string
    },

    /** null = guia inexistente na clínica. */
    async itensDaGuia(
      clinicId: string,
      guideId: string,
    ): Promise<{ id: string; requires_authorization: boolean; batch_id: string | null }[] | null> {
      const { data: guia, error: e1 } = await admin
        .from('insurance_guides')
        .select('id')
        .eq('id', guideId)
        .eq('clinic_id', clinicId)
        .maybeSingle()
      if (e1) throw new Error(e1.message)
      if (!guia) return null
      const { data, error } = await admin
        .from('insurance_guide_items')
        .select('id, requires_authorization, batch_id')
        .eq('guide_id', guideId)
        .eq('clinic_id', clinicId)
      if (error) throw new Error(error.message)
      return (data ?? []).map((i: { id: string; requires_authorization: boolean | null; batch_id: string | null }) => ({
        id: i.id,
        requires_authorization: !!i.requires_authorization,
        batch_id: i.batch_id,
      }))
    },

    async responderGuia(clinicId: string, guideId: string, r: RespostaGuia): Promise<GuideStatus> {
      const { data, error } = await admin.rpc('respond_insurance_guide', {
        p_clinic_id: clinicId,
        p_guide_id: guideId,
        p_number: r.guideNumber,
        p_password: r.password,
        p_valid_until: r.passwordValidUntil,
        p_items: r.itens.map((i) => ({ id: i.id, authorization: i.authorization, denial_reason: i.denialReason })),
      })
      if (error) lancar(error)
      return data as GuideStatus
    },

    async cancelarGuia(clinicId: string, guideId: string): Promise<void> {
      const { error } = await admin.rpc('cancel_insurance_guide', { p_clinic_id: clinicId, p_guide_id: guideId })
      if (error) lancar(error)
    },

    async item(
      clinicId: string,
      itemId: string,
    ): Promise<{
      id: string
      batch_id: string | null
      treatment_id: string | null
      guide: { insurance_plan_id: string; patient_id: string } | null
    } | null> {
      const { data, error } = await admin
        .from('insurance_guide_items')
        .select('id, batch_id, treatment_id, guide:insurance_guides(insurance_plan_id, patient_id)')
        .eq('id', itemId)
        .eq('clinic_id', clinicId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return data as unknown as Awaited<ReturnType<ReturnType<typeof createConveniosRepo>['item']>>
    },

    async atualizarItem(
      clinicId: string,
      itemId: string,
      dados: { code: string; name: string; teeth: GuideTooth[]; value: number },
    ): Promise<void> {
      const { data, error } = await admin
        .from('insurance_guide_items')
        .update({ code: dados.code, name: dados.name, teeth: dados.teeth, value: dados.value })
        .eq('id', itemId)
        .eq('clinic_id', clinicId)
        .is('batch_id', null)
        .select('id')
      if (error) throw new Error(error.message)
      if (!data?.length) lancar({ code: 'ITEM_EM_LOTE', message: 'ITEM_EM_LOTE' })
    },

    /** false = item inexistente ou já em lote. */
    async corrigirExecucao(clinicId: string, itemId: string, executedAt: string): Promise<boolean> {
      const { data, error } = await admin
        .from('insurance_guide_items')
        .update({ executed_at: executedAt })
        .eq('id', itemId)
        .eq('clinic_id', clinicId)
        .is('batch_id', null)
        .select('id')
      if (error) throw new Error(error.message)
      return !!data?.length
    },
  }
}

export type ConveniosRepo = ReturnType<typeof createConveniosRepo>
