// Leitura e escrita (service role) do estoque; toda consulta filtra por clinic_id.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { InventoryItem, InventoryMovement } from '@/types'
import type { ContagemInput, EntradaInput, ProdutoInput, SaidaInput } from './validar'

type Erro = { code?: string; message: string }

function lancar(error: Erro): never {
  throw { code: error.code, message: error.message }
}

type ProdutoCriacao = ProdutoInput & { initialQuantity?: number; lotCode?: string | null; expiresAt?: string | null }
type Despesa = { id: string; amount: number; status: 'paid' | 'pending' } | null
type LoteSaida = { lot_id: string; lot_code: string | null; quantidade: number }

export function createEstoqueRepo(admin: SupabaseClient) {
  return {
    async listar(clinicId: string, f: { inativos: boolean }): Promise<InventoryItem[]> {
      let q = admin
        .from('inventory_items')
        .select('*, lots:inventory_lots(id,item_id,clinic_id,lot_code,expires_at,quantity,created_at)')
        .eq('clinic_id', clinicId)
      if (!f.inativos) q = q.eq('active', true)
      const { data, error } = await q.order('name')
      if (error) lancar(error)
      return ((data ?? []) as unknown as InventoryItem[])
        .map((i) => ({ ...i, lots: (i.lots ?? []).filter((l) => l.quantity > 0 && (l as { clinic_id?: string }).clinic_id === clinicId) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    },

    async criar(clinicId: string, userId: string, i: ProdutoCriacao): Promise<string> {
      const p_data: Record<string, unknown> = {
        name: i.name,
        category: i.category,
        unit: i.unit,
        min_quantity: i.minQuantity,
        ideal_quantity: i.idealQuantity,
        supplier: i.supplier,
        tracks_expiry: i.trackExpiry,
      }
      if (i.initialQuantity !== undefined) p_data.initial_quantity = i.initialQuantity
      if (i.lotCode !== undefined) p_data.lot_code = i.lotCode
      if (i.expiresAt !== undefined) p_data.expires_at = i.expiresAt
      const { data, error } = await admin.rpc('create_inventory_item', {
        p_clinic_id: clinicId,
        p_user_id: userId,
        p_data,
      })
      if (error) lancar(error)
      return data as string
    },

    // update_inventory_item sobrescreve todos os campos: sempre enviar as 8 chaves.
    async editar(clinicId: string, id: string, i: ProdutoInput & { active?: boolean }): Promise<void> {
      const { error } = await admin.rpc('update_inventory_item', {
        p_clinic_id: clinicId,
        p_id: id,
        p_data: {
          name: i.name,
          category: i.category,
          unit: i.unit,
          min_quantity: i.minQuantity,
          ideal_quantity: i.idealQuantity,
          supplier: i.supplier,
          active: i.active,
          tracks_expiry: i.trackExpiry,
        },
      })
      if (error) lancar(error)
    },

    async entrada(
      clinicId: string,
      userId: string,
      id: string,
      i: EntradaInput,
    ): Promise<{ quantity: number; expense: Despesa }> {
      const p = i.payment
      const { data, error } = await admin.rpc('inventory_entry', {
        p_clinic_id: clinicId,
        p_user_id: userId,
        p_item_id: id,
        p_quantity: i.quantity,
        p_kind: i.kind,
        p_lot_code: i.lotCode,
        p_expires_at: i.expiresAt,
        p_notes: i.notes,
        p_total_cost: i.totalCostCents === null ? null : i.totalCostCents / 100,
        p_payment:
          p === null
            ? null
            : p.status === 'paid'
              ? { status: 'paid', method: p.method, date: p.date }
              : { status: 'pending', due_date: p.dueDate },
      })
      if (error) lancar(error)
      return data as { quantity: number; expense: Despesa }
    },

    async saida(
      clinicId: string,
      userId: string,
      id: string,
      i: SaidaInput,
    ): Promise<{ quantity: number; lotes: LoteSaida[] }> {
      const { data, error } = await admin.rpc('inventory_exit', {
        p_clinic_id: clinicId,
        p_user_id: userId,
        p_item_id: id,
        p_quantity: i.quantity,
        p_kind: i.kind,
        p_lot_id: i.lotId,
        p_notes: i.notes,
      })
      if (error) lancar(error)
      return data as { quantity: number; lotes: LoteSaida[] }
    },

    async contagem(
      clinicId: string,
      userId: string,
      id: string,
      i: ContagemInput,
    ): Promise<{ quantity: number; diferenca: number }> {
      const { data, error } = await admin.rpc('inventory_count', {
        p_clinic_id: clinicId,
        p_user_id: userId,
        p_item_id: id,
        p_lot_id: i.lotId,
        p_counted: i.counted,
        p_notes: i.notes,
      })
      if (error) lancar(error)
      return data as { quantity: number; diferenca: number }
    },

    async baixarLote(clinicId: string, userId: string, loteId: string): Promise<{ quantity: number; baixado: number }> {
      const { data, error } = await admin.rpc('inventory_discard_lot', {
        p_clinic_id: clinicId,
        p_user_id: userId,
        p_lot_id: loteId,
      })
      if (error) lancar(error)
      return data as { quantity: number; baixado: number }
    },

    async movimentos(
      clinicId: string,
      f: { de: string; ate: string; produtoId?: string; tipo?: 'in' | 'out' },
    ): Promise<InventoryMovement[]> {
      let q = admin
        .from('inventory_movements')
        .select('*, item:inventory_items(id,name,unit), lot:inventory_lots(lot_code,expires_at)')
        .eq('clinic_id', clinicId)
        .gte('created_at', `${f.de}T00:00:00-03:00`)
        .lte('created_at', `${f.ate}T23:59:59.999-03:00`)
      if (f.produtoId) q = q.eq('item_id', f.produtoId)
      if (f.tipo) q = q.eq('type', f.tipo)
      const { data, error } = await q.order('created_at', { ascending: false }).limit(500)
      if (error) lancar(error)
      return (data ?? []) as unknown as InventoryMovement[]
    },
  }
}
