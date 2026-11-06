import type { SupabaseClient } from '@supabase/supabase-js'
import { todayYmd } from '@/lib/messaging/time'
import type { FichaInput } from './ficha'

const LIMITE = 50

function check(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

type RawTreatment = {
  id: string; procedure: string; status: 'planned' | 'in_progress'; date: string
  treatment_teeth: { tooth_number: number; faces: string[] | null }[] | null
}
type RawItem = {
  id: string; procedure: string; tooth: string | null; status: 'pending' | 'in_progress'
  budgets: { created_at: string } | { created_at: string }[] | null
}

/**
 * Lê o que a ficha precisa; devolve null se o paciente não é da clínica.
 * Só tratamentos e itens aprovados em aberto, os 50 mais recentes de cada.
 */
export async function loadFichaInput(
  admin: SupabaseClient,
  clinicId: string,
  patientId: string,
): Promise<FichaInput | null> {
  const pat = await admin.from('patients').select('id').eq('clinic_id', clinicId).eq('id', patientId).maybeSingle()
  if (pat.error?.code === '22P02') return null
  check(pat.error)
  if (!pat.data) return null

  const [tr, it] = await Promise.all([
    admin
      .from('treatments')
      .select('id, procedure, status, date, treatment_teeth(tooth_number, faces)')
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)
      .in('status', ['planned', 'in_progress'])
      .order('date', { ascending: false })
      .limit(LIMITE),
    admin
      .from('budget_items')
      .select('id, procedure, tooth, status, budgets!inner(created_at, clinic_id, patient_id, status)')
      .eq('budgets.clinic_id', clinicId)
      .eq('budgets.patient_id', patientId)
      .eq('budgets.status', 'approved')
      .eq('approved', true)
      .in('status', ['pending', 'in_progress'])
      .order('budgets(created_at)', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(LIMITE),
  ])
  check(tr.error)
  check(it.error)

  return {
    treatments: ((tr.data ?? []) as unknown as RawTreatment[]).map((t) => ({
      id: t.id, procedure: t.procedure, status: t.status, date: t.date,
      teeth: (t.treatment_teeth ?? []).map((d) => ({ tooth_number: d.tooth_number, faces: d.faces ?? [] })),
    })),
    budgetItems: ((it.data ?? []) as unknown as RawItem[]).flatMap((i) => {
      const b = Array.isArray(i.budgets) ? i.budgets[0] : i.budgets
      return b ? [{ id: i.id, procedure: i.procedure, tooth: i.tooth, status: i.status, budget_date: todayYmd(new Date(b.created_at), 'America/Sao_Paulo') }] : []
    }),
  }
}
