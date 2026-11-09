import { todayYmd } from '@/lib/messaging/time'
import { mesAnterior, mesDe, primeiroDia, ultimoDia } from '@/lib/comissoes/periodo'
import { buildFunnel, type Funnel, type FunnelRow } from '@/lib/orcamentos/funil'
import { maisFaltam, resumoAgenda, type ConsultaIn, type Contagem } from './agenda'
import { pacientesNovos, producao, resumoFinanceiro, type PacienteIn, type RecebimentoIn, type TratamentoIn } from './financeiro'
import { mesesJanela } from './periodo'
import { variacaoTaxa, variacaoValor, type Variacao } from './variacao'

export type EntradaPainel = {
  consultas: ConsultaIn[]
  recebimentos: RecebimentoIn[]
  tratamentos: TratamentoIn[]
  pacientes: PacienteIn[]
  funil: FunnelRow[]
  profissionais: { id: string; name: string }[]
  nomesPacientes: Record<string, string>
}

export type Cartao = { valor: number | null; variacao: Variacao }

export type Painel = {
  mes: string
  hoje: string
  parcial: boolean
  dentista: { id: string; name: string } | null
  cartoes: { comparecimento: Cartao; faltas: Cartao; recebido: Cartao; ticket: Cartao; aprovacao: Cartao; novos: Cartao }
  agenda: Contagem & {
    porDentista: ({ professional_id: string; nome: string } & Contagem)[]
    maisFaltam: { patient_id: string; nome: string; faltas: number; ultima: string }[]
  }
  financeiro: ReturnType<typeof resumoFinanceiro> & {
    producao: { totalCentavos: number; porDentista: { professional_id: string | null; nome: string; totalCentavos: number }[] }
  }
  orcamentos: Funnel
  novos: { total: number; whatsapp: number }
  tendencia: {
    mes: string
    comparecimento: number | null
    recebidoCentavos: number
    ticketCentavos: number | null
    aprovacao: number | null
    novos: number
  }[]
}

const SEM_DENTISTA = 'Sem dentista'
const porNome = <T extends { nome: string }>(a: T, b: T) => a.nome.localeCompare(b.nome, 'pt-BR')

export function montarPainel(e: EntradaPainel, mes: string, agora: Date, professionalId: string | null): Painel {
  const hoje = todayYmd(agora, 'America/Sao_Paulo')
  const nomeDe = new Map(e.profissionais.map((p) => [p.id, p.name]))
  const nomeProf = (id: string | null) => (id === null ? SEM_DENTISTA : (nomeDe.get(id) ?? SEM_DENTISTA))

  const aprovacao = (m: string) =>
    buildFunnel(e.funil, {
      from: primeiroDia(m),
      to: ultimoDia(m),
      professionalId: professionalId ?? undefined,
    })
  const agendaDe = (m: string) => resumoAgenda(e.consultas, m, agora, professionalId)

  const anterior = mesAnterior(mes)
  const ag = agendaDe(mes)
  const agAnt = agendaDe(anterior)
  const fin = resumoFinanceiro(e.recebimentos, mes)
  const finAnt = resumoFinanceiro(e.recebimentos, anterior)
  const nov = pacientesNovos(e.pacientes, mes)
  const novAnt = pacientesNovos(e.pacientes, anterior)
  const orc = aprovacao(mes)
  const orcAnt = aprovacao(anterior)
  const prod = producao(e.tratamentos, mes, professionalId)

  const faltas = maisFaltam(e.consultas, mesesJanela(mes), agora, professionalId).map((m) => ({
    patient_id: m.patient_id,
    nome: e.nomesPacientes[m.patient_id] ?? '',
    faltas: m.faltas,
    ultima: m.ultima,
  }))

  const tendencia = mesesJanela(mes).map((m) => {
    const f = resumoFinanceiro(e.recebimentos, m)
    return {
      mes: m,
      comparecimento: agendaDe(m).comparecimento,
      recebidoCentavos: f.recebidoCentavos,
      ticketCentavos: f.ticketCentavos,
      aprovacao: aprovacao(m).rateCents,
      novos: pacientesNovos(e.pacientes, m).total,
    }
  })

  return {
    mes,
    hoje,
    parcial: mes === mesDe(hoje),
    dentista: professionalId === null ? null : { id: professionalId, name: nomeDe.get(professionalId) ?? '' },
    cartoes: {
      comparecimento: { valor: ag.comparecimento, variacao: variacaoTaxa(ag.comparecimento, agAnt.comparecimento) },
      faltas: { valor: ag.faltas, variacao: variacaoValor(ag.faltas, agAnt.faltas) },
      recebido: { valor: fin.recebidoCentavos, variacao: variacaoValor(fin.recebidoCentavos, finAnt.recebidoCentavos) },
      ticket: {
        valor: fin.ticketCentavos,
        variacao:
          fin.ticketCentavos === null ? variacaoTaxa(null, null) : variacaoValor(fin.ticketCentavos, finAnt.ticketCentavos ?? 0),
      },
      aprovacao: { valor: orc.rateCents, variacao: variacaoTaxa(orc.rateCents, orcAnt.rateCents) },
      novos: { valor: nov.total, variacao: variacaoValor(nov.total, novAnt.total) },
    },
    agenda: {
      ...ag,
      porDentista: ag.porDentista.map((d) => ({ ...d, nome: nomeProf(d.professional_id) })).sort(porNome),
      maisFaltam: faltas,
    },
    financeiro: {
      ...fin,
      producao: {
        totalCentavos: prod.totalCentavos,
        porDentista: prod.porDentista
          .map((d) => ({ ...d, nome: nomeProf(d.professional_id) }))
          .sort(porNome),
      },
    },
    orcamentos: orc,
    novos: nov,
    tendencia,
  }
}
