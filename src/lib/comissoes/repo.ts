// Leitura (service role) para o cálculo de comissões e chamadas às funções SQL; toda consulta filtra por clinic_id.

import type { SupabaseClient } from '@supabase/supabase-js'
import { fromDbPaidAt } from '@/lib/payments/dates'
import { lerTudo } from '@/lib/supabase/lerTudo'
import type { RecebimentoIn, TratamentoIn } from './alocacao'
import type { EntradaCalculo, Extrato, FechamentoIn, ItemConvenioIn, LaboratorioIn, ProfissionalIn } from './calculo'
import { primeiroDia } from './periodo'

type Erro = { code?: string; message: string }

function lancar(error: Erro): never {
  throw { code: error.code, message: error.message }
}

function pedacos<T>(lista: T[], n: number): T[][] {
  const r: T[][] = []
  for (let i = 0; i < lista.length; i += n) r.push(lista.slice(i, i + n))
  return r
}

type LinhaPagamento = {
  id: string
  patient_id: string
  amount: number
  net_amount: number | null
  payment_method: string | null
  paid_at: string | null
  created_at: string
}
type LinhaItem = {
  id: string
  name: string
  paid_value: number | null
  recovered_value: number | null
  payment_id: string | null
  recovered_payment_id: string | null
  treatment: { professional_id: string | null } | null
  guide: { patient_id: string; professional_id: string | null } | null
}
type LinhaFechamento = {
  id: string
  professional_id: string
  period: string
  amount: number
  status: 'fechado' | 'pago'
  closed_at: string
  paid_at: string | null
  payment_method: string | null
  statement: Extrato
}

const PROFISSIONAL = 'id, name, commission_rate, commission_rate_insurance, commission_start'

function profissionalIn(p: ProfissionalIn): ProfissionalIn {
  return {
    ...p,
    commission_rate: p.commission_rate === null ? null : Number(p.commission_rate),
    commission_rate_insurance: p.commission_rate_insurance === null ? null : Number(p.commission_rate_insurance),
    commission_start: p.commission_start ? p.commission_start.slice(0, 10) : null,
  }
}

export function createComissoesRepo(admin: SupabaseClient) {
  return {
    async entradaCalculo(clinicId: string): Promise<EntradaCalculo> {
      const pagamentos = await lerTudo<LinhaPagamento>((de, ate) =>
        admin
          .from('payments')
          .select('id, patient_id, amount, net_amount, payment_method, paid_at, created_at')
          .eq('clinic_id', clinicId)
          .eq('status', 'paid')
          .order('id')
          .range(de, ate),
      )
      // Inclui recebimentos de convênio: a alocação os ignora, mas os itens de guia usam a data deles.
      const recebimentos: RecebimentoIn[] = []
      const dataDoPagamento = new Map<string, string>()
      for (const p of pagamentos) {
        const paidAt = fromDbPaidAt(p.paid_at)
        if (!paidAt) continue
        dataDoPagamento.set(p.id, paidAt)
        recebimentos.push({
          id: p.id,
          patient_id: p.patient_id,
          amount: Number(p.amount),
          net_amount: p.net_amount === null ? null : Number(p.net_amount),
          payment_method: p.payment_method,
          paid_at: paidAt,
          created_at: p.created_at,
        })
      }

      const emGuia = new Set(
        (
          await lerTudo<{ treatment_id: string | null }>((de, ate) =>
            admin
              .from('insurance_guide_items')
              .select('treatment_id')
              .eq('clinic_id', clinicId)
              .eq('active', true)
              .not('treatment_id', 'is', null)
              .order('id')
              .range(de, ate),
          )
        ).map((l) => l.treatment_id),
      )
      const tratamentosBrutos = await lerTudo<Omit<TratamentoIn, 'em_guia'>>((de, ate) =>
        admin
          .from('treatments')
          .select('id, patient_id, professional_id, procedure, value, completed_at, created_at')
          .eq('clinic_id', clinicId)
          .eq('status', 'completed')
          .not('completed_at', 'is', null)
          .order('id')
          .range(de, ate),
      )
      const tratamentos: TratamentoIn[] = tratamentosBrutos.map((t) => ({
        ...t,
        value: Number(t.value),
        completed_at: t.completed_at ? t.completed_at.slice(0, 10) : null,
        em_guia: emGuia.has(t.id),
      }))

      const itens = await lerTudo<LinhaItem>((de, ate) =>
        admin
          .from('insurance_guide_items')
          .select(
            'id, name, paid_value, recovered_value, payment_id, recovered_payment_id, treatment:treatments(professional_id), guide:insurance_guides(patient_id, professional_id)',
          )
          .eq('clinic_id', clinicId)
          .or('payment_id.not.is.null,recovered_payment_id.not.is.null')
          .order('id')
          .range(de, ate),
      )
      const itensConvenio: ItemConvenioIn[] = itens
        .filter((i) => i.guide)
        .map((i) => ({
          item_id: i.id,
          patient_id: i.guide!.patient_id,
          professional_id: i.treatment?.professional_id ?? i.guide!.professional_id,
          descricao: i.name,
          paid_value: i.paid_value === null ? null : Number(i.paid_value),
          pago_em: i.payment_id ? (dataDoPagamento.get(i.payment_id) ?? null) : null,
          recovered_value: i.recovered_value === null ? null : Number(i.recovered_value),
          recuperado_em: i.recovered_payment_id ? (dataDoPagamento.get(i.recovered_payment_id) ?? null) : null,
        }))

      const despesas = await lerTudo<{
        id: string
        professional_id: string
        description: string
        amount: number
        paid_at: string | null
      }>((de, ate) =>
        admin
          .from('expenses')
          .select('id, professional_id, description, amount, paid_at')
          .eq('clinic_id', clinicId)
          .eq('category', 'laboratorio')
          .eq('status', 'paid')
          .not('professional_id', 'is', null)
          .order('id')
          .range(de, ate),
      )
      const laboratorio: LaboratorioIn[] = []
      for (const d of despesas) {
        const paidAt = fromDbPaidAt(d.paid_at)
        if (!paidAt) continue
        laboratorio.push({
          id: d.id,
          professional_id: d.professional_id,
          description: d.description,
          amount: Number(d.amount),
          paid_at: paidAt,
        })
      }

      const profissionais = (
        await lerTudo<ProfissionalIn>((de, ate) =>
          admin.from('professionals').select(PROFISSIONAL).eq('clinic_id', clinicId).order('id').range(de, ate),
        )
      ).map(profissionalIn)

      const fechamentos: FechamentoIn[] = (
        await lerTudo<LinhaFechamento>((de, ate) =>
          admin
            .from('commission_closings')
            .select('id, professional_id, period, amount, status, closed_at, paid_at, payment_method, statement')
            .eq('clinic_id', clinicId)
            .order('id')
            .range(de, ate),
        )
      ).map((f) => ({
        id: f.id,
        professional_id: f.professional_id,
        period: f.period.slice(0, 10),
        amountCentavos: Math.round(Number(f.amount) * 100),
        status: f.status,
        closed_at: f.closed_at,
        paid_at: f.paid_at,
        payment_method: f.payment_method,
        statement: f.statement,
      }))

      const idsPacientes = [
        ...new Set([...recebimentos.map((r) => r.patient_id), ...itensConvenio.map((i) => i.patient_id)]),
      ]
      const nomesPacientes: Record<string, string> = {}
      for (const grupo of pedacos(idsPacientes, 100)) {
        const nomes = await lerTudo<{ id: string; name: string }>((de, ate) =>
          admin.from('patients').select('id, name').eq('clinic_id', clinicId).in('id', grupo).order('id').range(de, ate),
        )
        for (const n of nomes) nomesPacientes[n.id] = n.name
      }

      return { recebimentos, tratamentos, itensConvenio, laboratorio, profissionais, fechamentos, nomesPacientes }
    },

    async profissional(clinicId: string, id: string): Promise<ProfissionalIn | null> {
      const { data, error } = await admin
        .from('professionals')
        .select(PROFISSIONAL)
        .eq('clinic_id', clinicId)
        .eq('id', id)
        .maybeSingle()
      if (error) lancar(error)
      return data ? profissionalIn(data as ProfissionalIn) : null
    },

    async fecharMes(clinicId: string, professionalId: string, mes: string, extrato: Extrato): Promise<string> {
      const { data, error } = await admin.rpc('close_commission', {
        p_clinic_id: clinicId,
        p_professional_id: professionalId,
        p_period: primeiroDia(mes),
        p_amount: extrato.totalCentavos / 100,
        p_statement: extrato,
      })
      if (error) lancar(error)
      return data as string
    },

    async reabrir(clinicId: string, closingId: string): Promise<void> {
      const { error } = await admin.rpc('reopen_commission', { p_clinic_id: clinicId, p_closing_id: closingId })
      if (error) lancar(error)
    },

    async pagar(clinicId: string, closingId: string, paidAt: string, method: string): Promise<string> {
      const { data, error } = await admin.rpc('pay_commission', {
        p_clinic_id: clinicId,
        p_closing_id: closingId,
        p_paid_at: paidAt,
        p_method: method,
      })
      if (error) lancar(error)
      return data as string
    },

    async desfazerPagamento(clinicId: string, closingId: string): Promise<void> {
      const { error } = await admin.rpc('undo_commission_payment', { p_clinic_id: clinicId, p_closing_id: closingId })
      if (error) lancar(error)
    },
  }
}
