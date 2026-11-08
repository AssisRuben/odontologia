// Pendências de convênio exibidas no painel. Datas são 'YYYY-MM-DD'.

import type { BatchStatus, GuideStatus } from '@/types'
import { diasEntre } from './periodo'

export type Pendencia = {
  tipo: 'guia_aguardando' | 'senha_vencendo' | 'tratamento_sem_faturar' | 'lote_prazo' | 'operadora_sem_fechamento'
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
}): { itens: Pendencia[]; contador: number } {
  const { hoje } = args
  const lotePrazo: Pendencia[] = []
  const semFaturar: Pendencia[] = []
  const aguardando: Pendencia[] = []
  const senhas: Pendencia[] = []
  const semFechamento: Pendencia[] = []

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
    itens: [...lotePrazo, ...semFaturar, ...aguardando, ...senhas, ...semFechamento],
    contador: semFaturar.length + lotePrazo.length,
  }
}
