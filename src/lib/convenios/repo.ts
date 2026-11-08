// Acesso ao banco (service role) para guias e itens; toda consulta filtra por clinic_id.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BatchStatus, GuideStatus, GuideTooth, InsuranceBatch, ItemAuthorization, TreatmentStatus } from '@/types'
import type { ItemNovo, RespostaGuia, TratamentoParaGuia } from './guias'
import { dataExecucao } from './prontidao'
import type { montarPendencias } from './pendencias'
import { mesesAntes } from './periodo'
import { todayYmd } from '@/lib/messaging/time'

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

export type ItemSemLote = {
  id: string
  guide_id: string
  plan_id: string
  active: boolean
  authorization: ItemAuthorization
  batch_id: string | null
  executed_at: string | null
  defer_until: string | null
  treatment: { status: TreatmentStatus; completed_at: string | null } | null
}

export type LoteComItens = InsuranceBatch & {
  plan: { id: string; name: string }
  total: number
  itens: {
    id: string
    patient_id: string
    patient_name: string
    insurance_card: string | null
    guide_number: string | null
    password: string | null
    code: string
    name: string
    teeth: GuideTooth[]
    executed_at: string | null
    value: number
    typed: boolean
  }[]
}

type DadosPendencias = Omit<Parameters<typeof montarPendencias>[0], 'hoje'>

const PAGINA = 1000

/** Lê todas as linhas de uma consulta, página a página (o PostgREST corta em 1000). */
async function lerTudo<T>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const todas: T[] = []
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await pagina(de, de + PAGINA - 1)
    if (error) throw new Error(error.message)
    const linhas = (data ?? []) as T[]
    todas.push(...linhas)
    if (linhas.length < PAGINA) return todas
  }
}

function pedacos<T>(lista: T[], n: number): T[][] {
  const r: T[][] = []
  for (let i = 0; i < lista.length; i += n) r.push(lista.slice(i, i + n))
  return r
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

    async operadoras(
      clinicId: string,
    ): Promise<{ id: string; name: string; closing_day: number | null; submission_days: number; active: boolean }[]> {
      const { data, error } = await admin
        .from('insurance_plans')
        .select('id, name, closing_day, submission_days, active')
        .eq('clinic_id', clinicId)
      if (error) throw new Error(error.message)
      return (data ?? []) as { id: string; name: string; closing_day: number | null; submission_days: number; active: boolean }[]
    },

    /** Itens ativos fora de lote, com a operadora da guia e o tratamento. */
    async itensSemLote(clinicId: string): Promise<ItemSemLote[]> {
      type L = Omit<ItemSemLote, 'plan_id'> & { guide: { insurance_plan_id: string } | null }
      const data = await lerTudo<L>((de, ate) =>
        admin
          .from('insurance_guide_items')
          .select(
            'id, guide_id, active, authorization, batch_id, executed_at, defer_until, guide:insurance_guides(insurance_plan_id), treatment:treatments(status, completed_at)',
          )
          .eq('clinic_id', clinicId)
          .eq('active', true)
          .is('batch_id', null)
          .order('id')
          .range(de, ate),
      )
      return data
        .filter((i) => i.guide)
        .map(({ guide, ...i }) => ({ ...i, plan_id: guide!.insurance_plan_id }))
    },

    async lotes(clinicId: string, planId?: string): Promise<InsuranceBatch[]> {
      let q = admin.from('insurance_batches').select('*').eq('clinic_id', clinicId)
      if (planId) q = q.eq('insurance_plan_id', planId)
      const { data, error } = await q
      if (error) throw new Error(error.message)
      return (data ?? []) as InsuranceBatch[]
    },

    /** Lote da clínica com o dia de fechamento da operadora; null = não existe. */
    async lote(
      clinicId: string,
      batchId: string,
    ): Promise<{ id: string; status: BatchStatus; period_end: string; closing_day: number | null } | null> {
      const { data, error } = await admin
        .from('insurance_batches')
        .select('id, status, period_end, plan:insurance_plans(closing_day)')
        .eq('id', batchId)
        .eq('clinic_id', clinicId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) return null
      const l = data as unknown as { id: string; status: BatchStatus; period_end: string; plan: { closing_day: number | null } | null }
      return { id: l.id, status: l.status, period_end: l.period_end, closing_day: l.plan?.closing_day ?? null }
    },

    async criarLotes(
      clinicId: string,
      planId: string,
      periodos: { period_start: string; period_end: string; due_date: string }[],
    ): Promise<void> {
      if (periodos.length === 0) return
      const { error } = await admin.from('insurance_batches').upsert(
        periodos.map((p) => ({ clinic_id: clinicId, insurance_plan_id: planId, ...p })),
        { onConflict: 'insurance_plan_id,period_end', ignoreDuplicates: true },
      )
      if (error) throw new Error(error.message)
    },

    async atribuir(clinicId: string, batchId: string, itemIds: string[]): Promise<number> {
      const { data, error } = await admin.rpc('assign_batch_items', {
        p_clinic_id: clinicId,
        p_batch_id: batchId,
        p_item_ids: itemIds,
      })
      if (error) lancar(error)
      return Number(data ?? 0)
    },

    async removerDoLote(clinicId: string, batchId: string, itemId: string, deferUntil: string): Promise<void> {
      const { error } = await admin.rpc('remove_batch_item', {
        p_clinic_id: clinicId,
        p_batch_id: batchId,
        p_item_id: itemId,
        p_defer_until: deferUntil,
      })
      if (error) lancar(error)
    },

    async enviarLote(clinicId: string, batchId: string, protocol: string, sentAt: string): Promise<void> {
      const { error } = await admin.rpc('send_insurance_batch', {
        p_clinic_id: clinicId,
        p_batch_id: batchId,
        p_protocol: protocol,
        p_sent_at: sentAt,
      })
      if (error) lancar(error)
    },

    /** false = item não está nesse lote. Lote inexistente ou enviado lança LOTE_INVALIDO / LOTE_ENVIADO. */
    async marcarDigitado(clinicId: string, batchId: string, itemId: string, typed: boolean): Promise<boolean> {
      const { data: lote, error: e1 } = await admin
        .from('insurance_batches')
        .select('status')
        .eq('id', batchId)
        .eq('clinic_id', clinicId)
        .maybeSingle()
      if (e1) throw new Error(e1.message)
      if (!lote) lancar({ code: 'P0001', message: 'LOTE_INVALIDO' })
      if ((lote as { status: BatchStatus }).status === 'enviado') lancar({ code: 'P0001', message: 'LOTE_ENVIADO' })
      const { data, error } = await admin
        .from('insurance_guide_items')
        .update({ typed })
        .eq('id', itemId)
        .eq('clinic_id', clinicId)
        .eq('batch_id', batchId)
        .select('id')
      if (error) throw new Error(error.message)
      return !!data?.length
    },

    /** Lotes abertos e enviados nos últimos 6 meses, com itens, guia, paciente e carteirinha. */
    async lotesComItens(clinicId: string, hoje = todayYmd(new Date(), 'America/Sao_Paulo')): Promise<LoteComItens[]> {
      const corte = mesesAntes(hoje, 6)
      const base = await lerTudo<InsuranceBatch & { plan: { id: string; name: string } }>((de, ate) =>
        admin
          .from('insurance_batches')
          .select('*, plan:insurance_plans(id, name)')
          .eq('clinic_id', clinicId)
          .or(`status.eq.aberto,and(status.eq.enviado,period_end.gte.${corte})`)
          .order('id')
          .range(de, ate),
      )
      if (base.length === 0) return []

      const itens: unknown[] = []
      for (const grupo of pedacos(base.map((l) => l.id), 50)) {
        itens.push(
          ...(await lerTudo<unknown>((de, ate) =>
            admin
              .from('insurance_guide_items')
              .select(
                'id, batch_id, code, name, teeth, value, typed, executed_at, guide:insurance_guides(patient_id, guide_number, password, insurance_card, patient:patients(name)), treatment:treatments(completed_at)',
              )
              .eq('clinic_id', clinicId)
              .in('batch_id', grupo)
              .order('id')
              .range(de, ate),
          )),
        )
      }
      type L = {
        id: string
        batch_id: string
        code: string
        name: string
        teeth: GuideTooth[] | null
        value: number | string | null
        typed: boolean
        executed_at: string | null
        guide: {
          patient_id: string
          guide_number: string | null
          password: string | null
          insurance_card: string | null
          patient: { name: string } | null
        } | null
        treatment: { completed_at: string | null } | null
      }
      const porLote = new Map<string, LoteComItens['itens']>()
      for (const i of itens as L[]) {
        const lista = porLote.get(i.batch_id) ?? []
        lista.push({
          id: i.id,
          patient_id: i.guide?.patient_id ?? '',
          patient_name: i.guide?.patient?.name ?? '',
          insurance_card: i.guide?.insurance_card ?? null,
          guide_number: i.guide?.guide_number ?? null,
          password: i.guide?.password ?? null,
          code: i.code,
          name: i.name,
          teeth: i.teeth ?? [],
          executed_at: dataExecucao(i, i.treatment),
          value: Number(i.value ?? 0),
          typed: i.typed,
        })
        porLote.set(i.batch_id, lista)
      }
      return base.map((l) => {
        const lista = (porLote.get(l.id) ?? []).sort((a, b) => a.patient_name.localeCompare(b.patient_name, 'pt-BR'))
        return { ...l, itens: lista, total: Math.round(lista.reduce((s, i) => s + i.value, 0) * 100) / 100 }
      })
    },

    /**
     * Entrada de `montarPendencias` (sem `hoje`). Só olha tratamentos concluídos
     * nos últimos 6 meses: o histórico anterior foi cobrado fora do sistema.
     */
    async dadosPendencias(clinicId: string, hoje = todayYmd(new Date(), 'America/Sao_Paulo')): Promise<DadosPendencias> {
      type T = {
        id: string
        patient_id: string
        procedure: string
        insurance_plan_id: string
        insurance_procedure_id: string | null
        patient: { name: string } | null
        proc: { insurance_plan_id: string; active: boolean } | null
      }
      const corte = mesesAntes(hoje, 6)
      const tratamentos = await lerTudo<T>((de, ate) =>
        admin
          .from('treatments')
          .select(
            'id, patient_id, procedure, insurance_plan_id, insurance_procedure_id, patient:patients(name), proc:insurance_plan_procedures(insurance_plan_id, active)',
          )
          .eq('clinic_id', clinicId)
          .not('insurance_plan_id', 'is', null)
          .eq('status', 'completed')
          .gte('completed_at', corte)
          .order('id')
          .range(de, ate),
      )

      const autorizacao = new Map<string, ItemAuthorization>()
      for (const grupo of pedacos(tratamentos.map((t) => t.id), 100)) {
        const itens = await lerTudo<{ treatment_id: string; authorization: ItemAuthorization }>((de, ate) =>
          admin
            .from('insurance_guide_items')
            .select('treatment_id, authorization')
            .eq('clinic_id', clinicId)
            .eq('active', true)
            .in('treatment_id', grupo)
            .order('id')
            .range(de, ate),
        )
        for (const r of itens) autorizacao.set(r.treatment_id, r.authorization)
      }

      const pend: DadosPendencias['tratamentos'] = []
      for (const t of tratamentos) {
        // Procedimento desativado na tabela conta como fora da tabela (igual a tratamentosParaGuia).
        const fora = !t.insurance_procedure_id || !t.proc || !t.proc.active || t.proc.insurance_plan_id !== t.insurance_plan_id
        const aut = autorizacao.get(t.id)
        const situacao = fora ? 'fora_tabela' : aut === undefined ? 'sem_guia' : aut === 'pendente' ? 'pendente' : null
        if (!situacao) continue
        pend.push({ id: t.id, patient_id: t.patient_id, patient_name: t.patient?.name ?? '', procedure: t.procedure, situacao })
      }

      type G = {
        id: string
        patient_id: string
        status: GuideStatus
        requested_at: string
        password_valid_until: string | null
        patient: { name: string } | null
        plan: { name: string } | null
        items: { batch_id: string | null; active: boolean }[] | null
      }
      const guias = await lerTudo<G>((de, ate) =>
        admin
          .from('insurance_guides')
          .select(
            'id, patient_id, status, requested_at, password_valid_until, patient:patients(name), plan:insurance_plans(name), items:insurance_guide_items(batch_id, active)',
          )
          .eq('clinic_id', clinicId)
          .in('status', ['aguardando', 'liberada'])
          .order('id')
          .range(de, ate),
      )
      const guiasOut = guias.map((g) => ({
        id: g.id,
        patient_id: g.patient_id,
        patient_name: g.patient?.name ?? '',
        plan_name: g.plan?.name ?? '',
        status: g.status,
        requested_at: g.requested_at,
        password_valid_until: g.password_valid_until,
        temItemSemLote: (g.items ?? []).some((i) => i.active && i.batch_id === null),
      }))

      type B = { id: string; period_end: string; status: BatchStatus; due_date: string; plan: { name: string } | null }
      const lotes = await lerTudo<B>((de, ate) =>
        admin
          .from('insurance_batches')
          .select('id, period_end, status, due_date, plan:insurance_plans(name)')
          .eq('clinic_id', clinicId)
          .eq('status', 'aberto')
          .order('id')
          .range(de, ate),
      )
      const lotesOut = lotes.map((l) => ({
        id: l.id,
        plan_name: l.plan?.name ?? '',
        period_end: l.period_end,
        status: l.status,
        due_date: l.due_date,
      }))

      const { data: semFech, error: e5 } = await admin
        .from('insurance_plans')
        .select('id, name')
        .eq('clinic_id', clinicId)
        .is('closing_day', null)
      if (e5) throw new Error(e5.message)
      const operadorasSemFechamento: { id: string; name: string }[] = []
      for (const o of (semFech ?? []) as { id: string; name: string }[]) {
        const { data, error } = await admin
          .from('treatments')
          .select('id')
          .eq('clinic_id', clinicId)
          .eq('insurance_plan_id', o.id)
          .neq('status', 'cancelled')
          .limit(1)
        if (error) throw new Error(error.message)
        if (data?.length) operadorasSemFechamento.push(o)
      }

      return { guias: guiasOut, tratamentos: pend, lotes: lotesOut, operadorasSemFechamento }
    },
  }
}

export type ConveniosRepo = ReturnType<typeof createConveniosRepo>
