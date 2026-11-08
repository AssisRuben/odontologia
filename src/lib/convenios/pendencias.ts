// Pendências de convênio exibidas no painel. Datas são 'YYYY-MM-DD'.

import type { AppealStatus, BatchStatus, GuideStatus } from '@/types'
import { diasEntre } from './periodo'
import { dataPrevista, prazoRecurso } from './pagamentos/calculo'

export type Pendencia = {
  tipo:
    | 'guia_aguardando'
    | 'senha_vencendo'
    | 'tratamento_sem_faturar'
    | 'lote_prazo'
    | 'operadora_sem_fechamento'
    | 'pagamento_atrasado'
    | 'recurso_prazo'
    | 'recurso_sem_recebimento'
  texto: string
  href: string
}

const ddmm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`
const mmaaaa = (ymd: string) => `${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`

const SITUACAO_TEXTO = {
  sem_guia: 'concluído sem guia',
  pendente: 'concluído aguardando autorização',
  fora_tabela: 'fora da tabela do convênio',
} as const

const dias = (n: number) => (n === 1 ? '1 dia' : `${n} dias`)

export function montarPendencias(args: {
  hoje: string
  guias: {
    id: string
    patient_id: string
    patient_name: string
    plan_name: string
    status: GuideStatus
    requested_at: string
    password_valid_until: string | null
    temItemSemLote: boolean
  }[]
  tratamentos: {
    id: string
    patient_id: string
    patient_name: string
    procedure: string
    situacao: 'sem_guia' | 'pendente' | 'fora_tabela'
  }[]
  lotes: { id: string; plan_name: string; period_end: string; status: BatchStatus; due_date: string }[]
  operadorasSemFechamento: { id: string; name: string }[]
  lotesEnviados: { id: string; plan_name: string; period_end: string; sent_at: string; payment_days: number }[]
  glosas: {
    item_id: string
    patient_name: string
    glosa_code: string | null
    paid_at: string
    appeal_days: number
    appeal_status: AppealStatus
    appeal_result_at: string | null
    recovered_payment_id: string | null
  }[]
}): { itens: Pendencia[]; contador: number } {
  const { hoje } = args
  const lotePrazo: Pendencia[] = []
  const semFaturar: Pendencia[] = []
  const aguardando: Pendencia[] = []
  const senhas: Pendencia[] = []
  const semFechamento: Pendencia[] = []
  const atrasados: Pendencia[] = []
  const recursoPrazo: Pendencia[] = []
  const semRecebimento: Pendencia[] = []
  const hrefPagamentos = '/convenios?aba=pagamentos'

  for (const l of args.lotesEnviados) {
    const n = diasEntre(dataPrevista(l.sent_at, l.payment_days), hoje)
    if (n <= 0) continue
    atrasados.push({
      tipo: 'pagamento_atrasado',
      texto: `Lote ${l.plan_name} ${mmaaaa(l.period_end)}: pagamento atrasado há ${dias(n)}`,
      href: hrefPagamentos,
    })
  }

  for (const g of args.glosas) {
    if (g.appeal_status === 'nenhum') {
      const n = diasEntre(hoje, prazoRecurso(g.paid_at, g.appeal_days))
      if (n > 5) continue
      const prazoTxt =
        n < 0 ? `prazo de recurso vencido há ${dias(-n)}` : n === 0 ? 'prazo de recurso hoje' : `prazo de recurso em ${dias(n)}`
      recursoPrazo.push({
        tipo: 'recurso_prazo',
        texto: `Glosa de ${g.patient_name} (${g.glosa_code ?? ''}): ${prazoTxt}`,
        href: hrefPagamentos,
      })
    } else if (g.appeal_status === 'aceito' && !g.recovered_payment_id && g.appeal_result_at) {
      const n = diasEntre(g.appeal_result_at, hoje)
      if (n > 30) {
        semRecebimento.push({
          tipo: 'recurso_sem_recebimento',
          texto: `Recurso aceito de ${g.patient_name} sem recebimento há ${dias(n)}`,
          href: hrefPagamentos,
        })
      }
    }
  }

  for (const l of args.lotes) {
    if (l.status !== 'aberto') continue
    const n = diasEntre(hoje, l.due_date)
    if (n > 3) continue
    const nome = `Lote ${l.plan_name} ${mmaaaa(l.period_end)}`
    const texto =
      n < 0 ? `${nome}: prazo vencido há ${dias(-n)}` : n === 0 ? `${nome}: prazo hoje` : `${nome}: prazo em ${dias(n)}`
    lotePrazo.push({ tipo: 'lote_prazo', texto, href: `/convenios?aba=lotes&lote=${l.id}` })
  }

  for (const t of args.tratamentos) {
    semFaturar.push({
      tipo: 'tratamento_sem_faturar',
      texto: `${t.procedure} de ${t.patient_name}: ${SITUACAO_TEXTO[t.situacao]}`,
      href: `/pacientes/${t.patient_id}?aba=tratamentos`,
    })
  }

  for (const g of args.guias) {
    if (g.status === 'cancelada') continue
    const href = `/pacientes/${g.patient_id}?aba=tratamentos`
    if (g.status === 'aguardando') {
      const n = diasEntre(g.requested_at, hoje)
      if (n > 7) {
        aguardando.push({
          tipo: 'guia_aguardando',
          texto: `Guia de ${g.patient_name} (${g.plan_name}) aguardando autorização há ${dias(n)}`,
          href,
        })
      }
    }
    if (g.password_valid_until && g.temItemSemLote && diasEntre(hoje, g.password_valid_until) <= 7) {
      const verbo = g.password_valid_until < hoje ? 'venceu' : 'vence'
      senhas.push({
        tipo: 'senha_vencendo',
        texto: `Senha da guia de ${g.patient_name} ${verbo} em ${ddmm(g.password_valid_until)}`,
        href,
      })
    }
  }

  for (const o of args.operadorasSemFechamento) {
    semFechamento.push({
      tipo: 'operadora_sem_fechamento',
      texto: `${o.name} sem dia de fechamento`,
      href: '/configuracoes/convenios',
    })
  }

  return {
    itens: [
      ...atrasados,
      ...recursoPrazo,
      ...lotePrazo,
      ...semFaturar,
      ...aguardando,
      ...senhas,
      ...semFechamento,
      ...semRecebimento,
    ],
    contador: semFaturar.length + lotePrazo.length + atrasados.length + recursoPrazo.length,
  }
}
