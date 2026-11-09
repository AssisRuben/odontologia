// Leitura (service role) da janela do painel de indicadores; toda consulta filtra por clinic_id.

import type { SupabaseClient } from '@supabase/supabase-js'
import { ultimoDia, primeiroDia } from '@/lib/comissoes/periodo'
import { loadFunnelSources } from '@/lib/orcamentos/repo'
import { fromDbPaidAt } from '@/lib/payments/dates'
import { lerTudo } from '@/lib/supabase/lerTudo'
import type { ConsultaIn } from './agenda'
import type { PacienteIn, RecebimentoIn, TratamentoIn } from './financeiro'
import type { EntradaPainel } from './painel'

function pedacos<T>(lista: T[], n: number): T[][] {
  const r: T[][] = []
  for (let i = 0; i < lista.length; i += n) r.push(lista.slice(i, i + n))
  return r
}

function diaSeguinte(dia: string): string {
  const d = new Date(`${dia}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

type LinhaPagamento = { patient_id: string; amount: number; payment_method: string | null; paid_at: string | null }
type LinhaTratamento = { professional_id: string | null; value: number; completed_at: string | null }

export async function entradaPainel(admin: SupabaseClient, clinicId: string, meses: string[]): Promise<EntradaPainel> {
  const primeiro = primeiroDia(meses[0])
  const depois = diaSeguinte(ultimoDia(meses[meses.length - 1]))
  // São Paulo não tem horário de verão: -03:00 fixo.
  const deLocal = `${primeiro}T00:00:00-03:00`
  const ateLocal = `${depois}T00:00:00-03:00`

  const consultas = await lerTudo<ConsultaIn>((de, ate) =>
    admin
      .from('appointments')
      .select('id, patient_id, professional_id, start_time, status')
      .eq('clinic_id', clinicId)
      .gte('start_time', deLocal)
      .lt('start_time', ateLocal)
      .order('id')
      .range(de, ate),
  )

  const pagamentos = await lerTudo<LinhaPagamento>((de, ate) =>
    admin
      .from('payments')
      .select('patient_id, amount, payment_method, paid_at')
      .eq('clinic_id', clinicId)
      .eq('status', 'paid')
      .gte('paid_at', `${primeiro}T00:00:00Z`)
      .lt('paid_at', `${depois}T00:00:00Z`)
      .order('id')
      .range(de, ate),
  )
  const recebimentos: RecebimentoIn[] = []
  for (const p of pagamentos) {
    const paidAt = fromDbPaidAt(p.paid_at)
    if (!paidAt) continue
    recebimentos.push({
      patient_id: p.patient_id,
      amount: Number(p.amount),
      payment_method: p.payment_method,
      paid_at: paidAt,
    })
  }

  const tratamentos: TratamentoIn[] = (
    await lerTudo<LinhaTratamento>((de, ate) =>
      admin
        .from('treatments')
        .select('professional_id, value, completed_at')
        .eq('clinic_id', clinicId)
        .eq('status', 'completed')
        .gte('completed_at', primeiro)
        .lte('completed_at', ultimoDia(meses[meses.length - 1]))
        .order('id')
        .range(de, ate),
    )
  )
    .filter((t) => t.completed_at)
    .map((t) => ({ professional_id: t.professional_id, value: Number(t.value), completed_at: t.completed_at!.slice(0, 10) }))

  const pacientes = await lerTudo<PacienteIn>((de, ate) =>
    admin
      .from('patients')
      .select('id, name, created_at, source')
      .eq('clinic_id', clinicId)
      .gte('created_at', deLocal)
      .lt('created_at', ateLocal)
      .order('id')
      .range(de, ate),
  )

  const funil = await loadFunnelSources(admin, clinicId)

  const profissionais = await lerTudo<{ id: string; name: string }>((de, ate) =>
    admin.from('professionals').select('id, name').eq('clinic_id', clinicId).order('id').range(de, ate),
  )

  const idsFaltosos = [...new Set(consultas.filter((c) => c.status === 'no_show').map((c) => c.patient_id))]
  const nomesPacientes: Record<string, string> = {}
  for (const grupo of pedacos(idsFaltosos, 100)) {
    const nomes = await lerTudo<{ id: string; name: string }>((de, ate) =>
      admin.from('patients').select('id, name').eq('clinic_id', clinicId).in('id', grupo).order('id').range(de, ate),
    )
    for (const n of nomes) nomesPacientes[n.id] = n.name
  }

  return { consultas, recebimentos, tratamentos, pacientes, funil, profissionais, nomesPacientes }
}
