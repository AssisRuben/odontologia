// Leitura e escrita (service role) do fluxo de caixa; toda consulta filtra por clinic_id.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DespesaFluxo, PagamentoFluxo } from './calcular'
import type { RecorrenciaInput, SaldoInput } from './validar'

type Erro = { code?: string; message: string }

function lancar(error: Erro): never {
  throw { code: error.code, message: error.message }
}

const centavos = (reais: number | string) => Math.round(Number(reais) * 100)
const emReais = (c: number) => c / 100
/** Início do dia em São Paulo, para filtrar timestamps. */
const inicioDoDia = (ymd: string) => `${ymd}T00:00:00-03:00`

type PagRow = {
  id: string
  amount: number | string
  net_amount: number | string | null
  status: PagamentoFluxo['status']
  due_date: string | null
  paid_at: string | null
  description: string | null
  patient: { name: string } | { name: string }[] | null
}
type DesRow = {
  id: string
  amount: number | string
  status: DespesaFluxo['status']
  due_date: string | null
  paid_at: string | null
  description: string | null
  recurrence_id: string | null
}

const SEL_PAG = 'id, amount, net_amount, status, due_date, paid_at, description, patient:patients(name)'
const SEL_DES = 'id, amount, status, due_date, paid_at, description, recurrence_id'

const payload = (i: RecorrenciaInput) => ({
  description: i.description,
  amount: emReais(i.amountCentavos),
  category: i.category,
  deduction_group: i.deductionGroup,
  payment_method: i.paymentMethod,
  day_of_month: i.dayOfMonth,
})

const PAGINA = 1000

/** Lê todas as páginas de uma consulta (o PostgREST limita cada resposta a 1000 linhas). */
async function todas<T>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: unknown; error: Erro | null }>,
): Promise<T[]> {
  const out: T[] = []
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await pagina(de, de + PAGINA - 1)
    if (error) lancar(error)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGINA) return out
  }
}

const mesDia1 = (ym: string) => `${ym}-01`

export function createFluxoRepo(admin: SupabaseClient) {
  return {
    async gerar(clinicId: string): Promise<number> {
      const { data, error } = await admin.rpc('generate_recurring_expenses', { p_clinic_id: clinicId })
      if (error) lancar(error)
      return Number(data ?? 0)
    },

    async saldoAtual(clinicId: string): Promise<{ data: string; valorCentavos: number } | null> {
      const { data, error } = await admin
        .from('cash_balances')
        .select('balance_date, amount')
        .eq('clinic_id', clinicId)
        .order('balance_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
      if (error) lancar(error)
      const r = ((data ?? []) as { balance_date: string; amount: number | string }[])[0]
      return r ? { data: r.balance_date, valorCentavos: centavos(r.amount) } : null
    },

    async informarSaldo(clinicId: string, userId: string, i: SaldoInput): Promise<void> {
      const { error } = await admin.from('cash_balances').insert({
        clinic_id: clinicId,
        balance_date: i.data,
        amount: emReais(i.valorCentavos),
        created_by: userId,
      })
      if (error) lancar(error)
    },

    async dados(
      clinicId: string,
      janela: { inicio: string; fim: string },
      desde: string,
    ): Promise<{ pagamentos: PagamentoFluxo[]; despesas: DespesaFluxo[] }> {
      const ini = inicioDoDia(desde)
      const pag = (f: (q: ReturnType<ReturnType<SupabaseClient['from']>['select']>) => unknown) => (de: number, ate: number) =>
        (f(admin.from('payments').select(SEL_PAG)) as { order: (c: string) => { range: (a: number, b: number) => PromiseLike<{ data: unknown; error: Erro | null }> } })
          .order('id')
          .range(de, ate)
      const des = (f: (q: ReturnType<ReturnType<SupabaseClient['from']>['select']>) => unknown) => (de: number, ate: number) =>
        (f(admin.from('expenses').select(SEL_DES)) as { order: (c: string) => { range: (a: number, b: number) => PromiseLike<{ data: unknown; error: Erro | null }> } })
          .order('id')
          .range(de, ate)
      const pagoQ = (q: ReturnType<ReturnType<SupabaseClient['from']>['select']>) =>
        q.eq('clinic_id', clinicId).eq('status', 'paid').gte('paid_at', ini)
      const abertoQ = (q: ReturnType<ReturnType<SupabaseClient['from']>['select']>) =>
        q.eq('clinic_id', clinicId).in('status', ['pending', 'overdue']).lte('due_date', janela.fim)
      const [pagos, abertos, dPagas, dAbertas] = await Promise.all([
        todas<PagRow>(pag(pagoQ)),
        todas<PagRow>(pag(abertoQ)),
        todas<DesRow>(des(pagoQ)),
        todas<DesRow>(des(abertoQ)),
      ])

      const pagamentos = [...pagos, ...abertos].map(
        (r): PagamentoFluxo => {
          const pac = Array.isArray(r.patient) ? r.patient[0] : r.patient
          return {
            id: r.id,
            valorCentavos: centavos(r.amount),
            liquidoCentavos: r.net_amount === null || r.net_amount === undefined ? null : centavos(r.net_amount),
            status: r.status,
            vencimento: r.due_date,
            pagoEm: r.paid_at,
            descricao: pac?.name ?? r.description ?? '',
          }
        },
      )
      const despesas = [...dPagas, ...dAbertas].map(
        (r): DespesaFluxo => ({
          id: r.id,
          valorCentavos: centavos(r.amount),
          status: r.status,
          vencimento: r.due_date,
          pagoEm: r.paid_at,
          descricao: r.description ?? '',
          recorrente: r.recurrence_id != null,
        }),
      )
      return { pagamentos, despesas }
    },

    async criarRecorrencia(clinicId: string, i: RecorrenciaInput): Promise<string> {
      const { data, error } = await admin.rpc('create_expense_recurrence', {
        p_clinic_id: clinicId,
        p_data: {
          ...payload(i),
          start_month: mesDia1(i.startMonth),
          end_month: i.endMonth ? mesDia1(i.endMonth) : null,
        },
      })
      if (error) lancar(error)
      return data as string
    },

    async editarRecorrencia(clinicId: string, id: string, i: RecorrenciaInput): Promise<number> {
      const { data, error } = await admin.rpc('update_expense_recurrence', {
        p_clinic_id: clinicId,
        p_id: id,
        p_data: payload(i),
        p_from_month: mesDia1(i.aPartirDe ?? ''),
      })
      if (error) lancar(error)
      return Number(data ?? 0)
    },

    async encerrarRecorrencia(clinicId: string, id: string, ultimoMes: string): Promise<number> {
      const { data, error } = await admin.rpc('end_expense_recurrence', {
        p_clinic_id: clinicId,
        p_id: id,
        p_last_month: mesDia1(ultimoMes),
      })
      if (error) lancar(error)
      return Number(data ?? 0)
    },
  }
}
