// Leitura e escrita (service role) dos kits e da baixa por tratamento; toda consulta filtra por clinic_id.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { InventoryMovement, Kit, MaterialStatus } from '@/types'
import { normalizar, sugerirKit } from './sugestao'
import type { BaixaInput, ItemKitInput, KitInput } from './validar'

type Erro = { code?: string; message: string }

function lancar(error: Erro): never {
  throw { code: error.code, message: error.message }
}

const SELECT_KIT = '*, items:inventory_kit_items(id,item_id,quantity,item:inventory_items(id,name,unit,quantity,active))'

export type MaterialInfo = {
  tratamento: {
    id: string
    procedure: string
    status: string
    material_status: MaterialStatus | null
    patient: { id: string; name: string } | null
  }
  sugestao: string | null
  kits: Kit[]
  movimentos: InventoryMovement[]
}

const paraSql = (items: ItemKitInput[]) => items.map((x) => ({ item_id: x.itemId, quantity: x.quantity }))

export function createKitsRepo(admin: SupabaseClient) {
  return {
    async listar(clinicId: string): Promise<Kit[]> {
      const { data, error } = await admin
        .from('inventory_kits')
        .select(SELECT_KIT)
        .eq('clinic_id', clinicId)
        .order('name')
      if (error) lancar(error)
      return (data ?? []) as unknown as Kit[]
    },

    async criar(clinicId: string, i: KitInput): Promise<string> {
      const { data, error } = await admin.rpc('create_inventory_kit', {
        p_clinic_id: clinicId,
        p_data: { name: i.name, active: i.active, items: paraSql(i.items) },
      })
      if (error) lancar(error)
      return data as string
    },

    async editar(clinicId: string, id: string, i: KitInput): Promise<void> {
      const { error } = await admin.rpc('update_inventory_kit', {
        p_clinic_id: clinicId,
        p_id: id,
        p_data: { name: i.name, active: i.active, items: paraSql(i.items) },
      })
      if (error) lancar(error)
    },

    async material(clinicId: string, treatmentId: string): Promise<MaterialInfo | null> {
      const t = await admin
        .from('treatments')
        .select('id,procedure,status,material_status,patient:patients(id,name)')
        .eq('id', treatmentId)
        .eq('clinic_id', clinicId)
        .maybeSingle()
      if (t.error) lancar(t.error)
      if (!t.data) return null
      const row = t.data as unknown as Omit<MaterialInfo['tratamento'], 'patient'> & {
        patient: { id: string; name: string } | { id: string; name: string }[] | null
      }
      const patient = Array.isArray(row.patient) ? (row.patient[0] ?? null) : row.patient
      const tratamento = { ...row, patient }

      const k = await admin
        .from('inventory_kits')
        .select(SELECT_KIT)
        .eq('clinic_id', clinicId)
        .eq('active', true)
        .order('name')
      if (k.error) lancar(k.error)
      const kits = (k.data ?? []) as unknown as Kit[]

      const u = await admin
        .from('treatments')
        .select('procedure,material_kit_id')
        .eq('clinic_id', clinicId)
        .eq('material_status', 'baixado')
        .not('material_kit_id', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(50)
      if (u.error) lancar(u.error)
      const alvo = normalizar(tratamento.procedure)
      const ultimo =
        ((u.data ?? []) as unknown as { procedure: string; material_kit_id: string | null }[]).find(
          (r) => normalizar(r.procedure) === alvo,
        )?.material_kit_id ?? null

      const m = await admin
        .from('inventory_movements')
        .select('*, item:inventory_items(id,name,unit), lot:inventory_lots(lot_code,expires_at)')
        .eq('clinic_id', clinicId)
        .eq('treatment_id', treatmentId)
        .eq('type', 'out')
        .order('created_at')
      if (m.error) lancar(m.error)

      return {
        tratamento,
        sugestao: sugerirKit(tratamento.procedure, kits, ultimo),
        kits,
        movimentos: (m.data ?? []) as unknown as InventoryMovement[],
      }
    },

    async baixar(clinicId: string, userId: string, treatmentId: string, i: BaixaInput): Promise<unknown> {
      const { data, error } = await admin.rpc('treatment_material_apply', {
        p_clinic_id: clinicId,
        p_user_id: userId,
        p_treatment_id: treatmentId,
        p_kit_id: i.kitId,
        p_items: paraSql(i.items),
      })
      if (error) lancar(error)
      return data
    },

    async dispensar(clinicId: string, treatmentId: string): Promise<void> {
      const { error } = await admin.rpc('treatment_material_skip', {
        p_clinic_id: clinicId,
        p_treatment_id: treatmentId,
      })
      if (error) lancar(error)
    },

    async devolver(clinicId: string, userId: string, treatmentId: string): Promise<{ devolvidos: number }> {
      const { data, error } = await admin.rpc('treatment_material_return', {
        p_clinic_id: clinicId,
        p_user_id: userId,
        p_treatment_id: treatmentId,
      })
      if (error) lancar(error)
      return data as { devolvidos: number }
    },

    async pendentes(clinicId: string, patientId: string): Promise<string[]> {
      const { data, error } = await admin
        .from('treatments')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .eq('status', 'completed')
        .eq('material_status', 'pendente')
      if (error) lancar(error)
      return ((data ?? []) as { id: string }[]).map((r) => r.id)
    },

    async nomeProduto(clinicId: string, itemId: string): Promise<string | null> {
      const { data, error } = await admin
        .from('inventory_items')
        .select('name')
        .eq('id', itemId)
        .eq('clinic_id', clinicId)
        .maybeSingle()
      if (error) lancar(error)
      return (data as { name: string } | null)?.name ?? null
    },
  }
}
