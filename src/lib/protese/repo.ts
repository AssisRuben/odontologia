// Leitura e escrita (service role) de próteses e laboratórios; toda consulta filtra por clinic_id.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Laboratory, Prosthetic, ProstheticStatus } from '@/types'
import { visivelNoQuadro } from './historico'
import type { LaboratorioInput, MoverInput, ProteseInput } from './validar'

type Erro = { code?: string; message: string }

function lancar(error: Erro): never {
  throw { code: error.code, message: error.message }
}

type Despesa = { id: string; amount: number } | null

const SELECT_PROTESE =
  '*, patient:patients(id,name), professional:professionals(id,name), lab:laboratories(id,name,active), events:prosthetic_events(id,from_status,to_status,note,created_at)'

// update_prosthetic sobrescreve todos os campos: sempre enviar as 8 chaves.
function paraDados(i: ProteseInput) {
  return {
    patient_id: i.patientId,
    professional_id: i.professionalId,
    laboratory_id: i.laboratoryId,
    type: i.type,
    tooth_region: i.toothRegion,
    expected_at: i.expectedAt,
    lab_cost: i.labCostCents === null ? null : i.labCostCents / 100,
    notes: i.notes,
  }
}

export function createProteseRepo(admin: SupabaseClient) {
  return {
    async listar(
      clinicId: string,
      f: { pacienteId?: string; todas: boolean; hojeYmd: string },
    ): Promise<Prosthetic[]> {
      let q = admin.from('prosthetics').select(SELECT_PROTESE).eq('clinic_id', clinicId)
      if (f.pacienteId) q = q.eq('patient_id', f.pacienteId)
      const { data, error } = await q.order('requested_at', { ascending: false })
      if (error) lancar(error)
      const lista = ((data ?? []) as unknown as Prosthetic[]).map((p) => ({
        ...p,
        events: [...(p.events ?? [])].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0)),
      }))
      // Na ficha do paciente o histórico completo sempre aparece.
      return f.pacienteId ? lista : lista.filter((p) => visivelNoQuadro(p, f.hojeYmd, f.todas))
    },

    async criar(clinicId: string, userId: string, i: ProteseInput): Promise<string> {
      const { data, error } = await admin.rpc('create_prosthetic', {
        p_clinic_id: clinicId,
        p_user_id: userId,
        p_data: paraDados(i),
      })
      if (error) lancar(error)
      return data as string
    },

    async editar(
      clinicId: string,
      id: string,
      i: ProteseInput,
    ): Promise<{ expense: Despesa; aviso: 'despesa_paga' | null; despesaRemovida: boolean }> {
      const { data, error } = await admin.rpc('update_prosthetic', {
        p_clinic_id: clinicId,
        p_id: id,
        p_data: paraDados(i),
      })
      if (error) lancar(error)
      const r = data as { expense: Despesa; aviso: 'despesa_paga' | null; despesa_removida?: boolean }
      return { expense: r.expense, aviso: r.aviso, despesaRemovida: r.despesa_removida === true }
    },

    async mover(
      clinicId: string,
      userId: string,
      id: string,
      i: MoverInput,
    ): Promise<{ status: ProstheticStatus; expense: Despesa }> {
      const { data, error } = await admin.rpc('move_prosthetic', {
        p_clinic_id: clinicId,
        p_user_id: userId,
        p_id: id,
        p_from: i.de,
        p_to: i.para,
        p_note: i.observacao,
        p_expected_at: i.previsao,
      })
      if (error) lancar(error)
      return data as { status: ProstheticStatus; expense: Despesa }
    },

    async excluir(clinicId: string, id: string): Promise<{ despesa: 'apagada' | 'mantida' | null }> {
      const { data, error } = await admin.rpc('delete_prosthetic', { p_clinic_id: clinicId, p_id: id })
      if (error) lancar(error)
      return data as { despesa: 'apagada' | 'mantida' | null }
    },

    async laboratorios(clinicId: string): Promise<(Laboratory & { emAndamento: number })[]> {
      const { data: labs, error } = await admin
        .from('laboratories')
        .select('*')
        .eq('clinic_id', clinicId)
        .order('name')
      if (error) lancar(error)
      const { data: abertas, error: erro2 } = await admin
        .from('prosthetics')
        .select('laboratory_id')
        .eq('clinic_id', clinicId)
        .neq('status', 'installed')
      if (erro2) lancar(erro2)
      const contagem = new Map<string, number>()
      for (const p of (abertas ?? []) as { laboratory_id: string | null }[]) {
        if (p.laboratory_id) contagem.set(p.laboratory_id, (contagem.get(p.laboratory_id) ?? 0) + 1)
      }
      return ((labs ?? []) as Laboratory[]).map((l) => ({ ...l, emAndamento: contagem.get(l.id) ?? 0 }))
    },

    async criarLaboratorio(clinicId: string, i: LaboratorioInput): Promise<Laboratory> {
      const { data, error } = await admin
        .from('laboratories')
        .insert({ clinic_id: clinicId, name: i.name, phone: i.phone, notes: i.notes })
        .select('*')
        .single()
      if (error) lancar(error)
      return data as Laboratory
    },

    async editarLaboratorio(clinicId: string, id: string, i: Partial<LaboratorioInput>): Promise<boolean> {
      const { data, error } = await admin
        .from('laboratories')
        .update(i)
        .eq('clinic_id', clinicId)
        .eq('id', id)
        .select('id')
      if (error) lancar(error)
      return (data ?? []).length > 0
    },
  }
}
