import { alocarParticular, type ParteParticular, type RecebimentoIn, type TratamentoIn } from './alocacao'
import { mesDe, primeiroDia } from './periodo'

export type ItemConvenioIn = {
  item_id: string
  patient_id: string
  professional_id: string | null
  descricao: string
  paid_value: number | null
  pago_em: string | null
  recovered_value: number | null
  recuperado_em: string | null
}

export type LaboratorioIn = { id: string; professional_id: string; description: string; amount: number; paid_at: string }

export type ProfissionalIn = {
  id: string
  name: string
  commission_rate: number | null
  commission_rate_insurance: number | null
  /** Dia 1 do mês a partir do qual há comissão (`YYYY-MM-DD`); nulo = sem comissão. */
  commission_start: string | null
}

export type Parte = {
  data: string
  patient_id: string
  paciente: string
  descricao: string
  origem: 'particular' | 'convenio' | 'recurso'
  baseCentavos: number
  percentual: number
  comissaoCentavos: number
}

export type DescontoLab = {
  data: string
  descricao: string
  custoCentavos: number
  percentual: number
  descontoCentavos: number
}

export type Extrato = {
  professional_id: string
  nome: string
  mes: string
  percentual: number | null
  percentualConvenio: number | null
  partes: Parte[]
  laboratorio: DescontoLab[]
  particularBaseCentavos: number
  convenioBaseCentavos: number
  laboratorioCustoCentavos: number
  comissaoMesCentavos: number
  ajusteCentavos: number
  totalCentavos: number
}

export type FechamentoIn = {
  id: string
  professional_id: string
  period: string
  amountCentavos: number
  status: 'fechado' | 'pago'
  closed_at: string
  paid_at: string | null
  payment_method: string | null
  statement: Extrato
}

export type EntradaCalculo = {
  recebimentos: RecebimentoIn[]
  tratamentos: TratamentoIn[]
  itensConvenio: ItemConvenioIn[]
  laboratorio: LaboratorioIn[]
  profissionais: ProfissionalIn[]
  fechamentos: FechamentoIn[]
  nomesPacientes: Record<string, string>
}

export type ResumoDentista = {
  professional_id: string
  nome: string
  semPercentual: boolean
  /** Tem percentual mas não tem mês inicial: sem comissão até definir. */
  semInicio: boolean
  situacao: 'aberto' | 'fechado' | 'pago'
  fechamento: Omit<FechamentoIn, 'statement'> | null
} & Pick<
  Extrato,
  | 'percentual'
  | 'percentualConvenio'
  | 'particularBaseCentavos'
  | 'convenioBaseCentavos'
  | 'laboratorioCustoCentavos'
  | 'comissaoMesCentavos'
  | 'ajusteCentavos'
  | 'totalCentavos'
>

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const comissao = (base: number, pct: number) => Math.round((base * pct) / 100)

/**
 * Partes e descontos do dentista desde o mês inicial (`comeco`, dia 1). Num mês fechado vale o
 * percentual congelado no fechamento; nos demais, o percentual de hoje.
 */
function ganhos(
  e: EntradaCalculo,
  prof: ProfissionalIn,
  comeco: string,
  particulares: ParteParticular[],
): { partes: Parte[]; laboratorio: DescontoLab[] } {
  const atual = { pct: prof.commission_rate as number, pctConv: prof.commission_rate_insurance ?? (prof.commission_rate as number) }
  const congelados = new Map<string, { pct: number; pctConv: number }>()
  for (const f of e.fechamentos) {
    if (f.professional_id !== prof.id || f.statement?.percentual === null || f.statement?.percentual === undefined) continue
    const pct = f.statement.percentual
    congelados.set(mesDe(f.period), { pct, pctConv: f.statement.percentualConvenio ?? pct })
  }
  const taxas = (data: string) => congelados.get(mesDe(data)) ?? atual
  const paciente = (id: string) => e.nomesPacientes[id] ?? ''
  const partes: Parte[] = []

  for (const p of particulares) {
    if (p.professional_id !== prof.id || p.data < comeco) continue
    const pct = taxas(p.data).pct
    partes.push({
      data: p.data, patient_id: p.patient_id, paciente: paciente(p.patient_id), descricao: p.procedure,
      origem: 'particular', baseCentavos: p.baseCentavos, percentual: pct, comissaoCentavos: comissao(p.baseCentavos, pct),
    })
  }

  for (const it of e.itensConvenio) {
    if (it.professional_id !== prof.id) continue
    const itens: [Parte['origem'], number | null, string | null][] = [
      ['convenio', it.paid_value, it.pago_em],
      ['recurso', it.recovered_value, it.recuperado_em],
    ]
    for (const [origem, valor, data] of itens) {
      if (valor === null || valor <= 0 || !data || data < comeco) continue
      const base = Math.round(valor * 100)
      const pctConv = taxas(data).pctConv
      partes.push({
        data, patient_id: it.patient_id, paciente: paciente(it.patient_id), descricao: it.descricao,
        origem, baseCentavos: base, percentual: pctConv, comissaoCentavos: comissao(base, pctConv),
      })
    }
  }

  const laboratorio: DescontoLab[] = e.laboratorio
    .filter(l => l.professional_id === prof.id && l.paid_at >= comeco)
    .map(l => {
      const custo = Math.round(l.amount * 100)
      const pct = taxas(l.paid_at).pct
      return { data: l.paid_at, descricao: l.description, custoCentavos: custo, percentual: pct, descontoCentavos: comissao(custo, pct) }
    })

  const ordem = (a: Parte, b: Parte) => cmp(a.data, b.data) || a.paciente.localeCompare(b.paciente, 'pt-BR')
  partes.sort(ordem)
  laboratorio.sort((a, b) => cmp(a.data, b.data))
  return { partes, laboratorio }
}

const soma = (xs: number[]) => xs.reduce((s, x) => s + x, 0)

export function extrato(e: EntradaCalculo, professionalId: string, mes: string): Extrato {
  return extratoCom(e, professionalId, mes, () => alocarParticular(e.recebimentos, e.tratamentos))
}

/** `particulares` só é chamado se o mês estiver aberto e o dentista tiver percentual. */
function extratoCom(
  e: EntradaCalculo,
  professionalId: string,
  mes: string,
  particulares: () => ParteParticular[],
): Extrato {
  const inicio = primeiroDia(mes)
  const fechado = e.fechamentos.find(f => f.professional_id === professionalId && f.period === inicio)
  if (fechado) return fechado.statement

  const prof = e.profissionais.find(p => p.id === professionalId)
  const vazio: Extrato = {
    professional_id: professionalId, nome: prof?.name ?? '', mes,
    percentual: prof?.commission_rate ?? null, percentualConvenio: prof?.commission_rate_insurance ?? null,
    partes: [], laboratorio: [], particularBaseCentavos: 0, convenioBaseCentavos: 0, laboratorioCustoCentavos: 0,
    comissaoMesCentavos: 0, ajusteCentavos: 0, totalCentavos: 0,
  }
  // Sem percentual, sem mês inicial ou antes do início: nada a pagar.
  const comeco = prof?.commission_start ?? null
  if (!prof || prof.commission_rate === null || comeco === null || inicio < comeco) return vazio

  const { partes, laboratorio } = ganhos(e, prof, comeco, particulares())
  const partesMes = partes.filter(p => mesDe(p.data) === mes)
  const labMes = laboratorio.filter(l => mesDe(l.data) === mes)

  const comissaoMesCentavos =
    soma(partesMes.map(p => p.comissaoCentavos)) - soma(labMes.map(l => l.descontoCentavos))
  const ganhoAnterior =
    soma(partes.filter(p => p.data < inicio).map(p => p.comissaoCentavos)) -
    soma(laboratorio.filter(l => l.data < inicio).map(l => l.descontoCentavos))
  const fechados = soma(
    e.fechamentos
      .filter(f => f.professional_id === professionalId && f.period >= comeco && f.period < inicio)
      .map(f => f.amountCentavos),
  )
  const ajusteCentavos = ganhoAnterior - fechados

  return {
    ...vazio,
    partes: partesMes,
    laboratorio: labMes,
    particularBaseCentavos: soma(partesMes.filter(p => p.origem === 'particular').map(p => p.baseCentavos)),
    convenioBaseCentavos: soma(partesMes.filter(p => p.origem !== 'particular').map(p => p.baseCentavos)),
    laboratorioCustoCentavos: soma(labMes.map(l => l.custoCentavos)),
    comissaoMesCentavos,
    ajusteCentavos,
    totalCentavos: comissaoMesCentavos + ajusteCentavos,
  }
}

export function resumoMes(e: EntradaCalculo, mes: string): ResumoDentista[] {
  const inicio = primeiroDia(mes)
  let cache: ParteParticular[] | null = null
  const particulares = () => (cache ??= alocarParticular(e.recebimentos, e.tratamentos))
  return [...e.profissionais]
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .map(prof => {
      const f = e.fechamentos.find(x => x.professional_id === prof.id && x.period === inicio)
      const x = extratoCom(e, prof.id, mes, particulares)
      const { statement: _statement, ...fechamento } = f ?? ({} as FechamentoIn)
      void _statement
      return {
        professional_id: prof.id,
        nome: prof.name,
        semPercentual: !f && prof.commission_rate === null,
        semInicio: !f && prof.commission_rate !== null && prof.commission_start === null,
        situacao: f ? f.status : 'aberto',
        fechamento: f ? fechamento : null,
        percentual: x.percentual,
        percentualConvenio: x.percentualConvenio,
        particularBaseCentavos: x.particularBaseCentavos,
        convenioBaseCentavos: x.convenioBaseCentavos,
        laboratorioCustoCentavos: x.laboratorioCustoCentavos,
        comissaoMesCentavos: x.comissaoMesCentavos,
        ajusteCentavos: x.ajusteCentavos,
        totalCentavos: x.totalCentavos,
      }
    })
}
