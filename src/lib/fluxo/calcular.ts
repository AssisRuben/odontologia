import { addDays, addMonths, endOfMonth, format, parseISO, startOfMonth } from 'date-fns'

export type PagamentoFluxo = {
  id: string
  valorCentavos: number
  liquidoCentavos: number | null
  status: 'pending' | 'paid' | 'overdue' | 'cancelled' | 'refunded'
  vencimento: string | null
  /** Timestamp ISO. */
  pagoEm: string | null
  /** Nome do paciente ou descrição. */
  descricao: string
}

export type DespesaFluxo = {
  id: string
  valorCentavos: number
  status: 'pending' | 'paid' | 'overdue'
  vencimento: string | null
  pagoEm: string | null
  descricao: string
  recorrente: boolean
}

export type Movimento = { tipo: 'entrada' | 'saida'; descricao: string; valorCentavos: number; previsto: boolean }
export type DiaFluxo = { data: string; movimentos: Movimento[]; saldoFinalCentavos: number }
export type MesFluxo = {
  mes: string // 'YYYY-MM'
  saldoInicialCentavos: number
  entradasCentavos: number
  saidasCentavos: number
  saldoFinalCentavos: number
  situacao: 'realizado' | 'atual' | 'previsto'
  dias: DiaFluxo[]
}
export type Fluxo = {
  meses: MesFluxo[]
  saldoHojeCentavos: number
  saldoFinalPrevistoCentavos: number
  menorSaldo: { valorCentavos: number; data: string }
  emAtraso: { totalCentavos: number; quantidade: number }
  semSaldoInformado: boolean
}

const fmtSP = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Converte um timestamp ISO na data (YYYY-MM-DD) de São Paulo. */
export function dataSaoPaulo(iso: string): string {
  return fmtSP.format(new Date(iso))
}

const ymd = (d: Date) => format(d, 'yyyy-MM-dd')

type Mov = Movimento & { data: string }

export function montarFluxo(e: {
  hoje: string
  saldo: { data: string; valorCentavos: number } | null
  pagamentos: PagamentoFluxo[]
  despesas: DespesaFluxo[]
}): Fluxo {
  const { hoje } = e
  const hojeDate = parseISO(hoje)
  const inicioJanela = startOfMonth(addMonths(hojeDate, -2))
  const fimJanela = endOfMonth(addMonths(hojeDate, 5))
  const fimStr = ymd(fimJanela)

  // --- Movimentos ---
  const movs: Mov[] = []
  let atrasoTotal = 0
  let atrasoQtd = 0

  for (const p of e.pagamentos) {
    if (p.status === 'cancelled' || p.status === 'refunded') continue
    if (p.status === 'paid') {
      // Pago sem pagoEm: usa o vencimento; sem nenhum dos dois, ignora.
      const data = p.pagoEm ? dataSaoPaulo(p.pagoEm) : p.vencimento
      if (!data) continue
      movs.push({ data, tipo: 'entrada', descricao: p.descricao, valorCentavos: p.liquidoCentavos ?? p.valorCentavos, previsto: false })
      continue
    }
    // Não pago: sem vencimento não há data para prever, fica de fora.
    if (!p.vencimento) continue
    if (p.vencimento < hoje) {
      atrasoTotal += p.valorCentavos
      atrasoQtd++
    } else {
      movs.push({ data: p.vencimento, tipo: 'entrada', descricao: p.descricao, valorCentavos: p.valorCentavos, previsto: true })
    }
  }

  for (const d of e.despesas) {
    if (d.status === 'paid') {
      const data = d.pagoEm ? dataSaoPaulo(d.pagoEm) : d.vencimento
      if (!data) continue
      movs.push({ data, tipo: 'saida', descricao: d.descricao, valorCentavos: d.valorCentavos, previsto: false })
    } else {
      const data = d.vencimento && d.vencimento > hoje ? d.vencimento : hoje
      movs.push({ data, tipo: 'saida', descricao: d.descricao, valorCentavos: d.valorCentavos, previsto: true })
    }
  }

  // --- Saldo ---
  const deltas = new Map<string, number>()
  for (const m of movs) {
    deltas.set(m.data, (deltas.get(m.data) ?? 0) + (m.tipo === 'entrada' ? m.valorCentavos : -m.valorCentavos))
  }
  const semSaldoInformado = e.saldo === null
  const refData = e.saldo ? e.saldo.data : ymd(addDays(inicioJanela, -1))
  const refValor = e.saldo ? e.saldo.valorCentavos : 0

  /** Saldo no fim do dia `d`, a partir do saldo de referência. */
  const saldoFim = (d: string): number => {
    let soma = 0
    if (d >= refData) {
      for (const [dt, v] of deltas) if (dt > refData && dt <= d) soma += v
      return refValor + soma
    }
    for (const [dt, v] of deltas) if (dt > d && dt <= refData) soma += v
    return refValor - soma
  }

  // --- Meses ---
  const mesHoje = hoje.slice(0, 7)
  const meses: MesFluxo[] = []
  for (let i = 0; i < 8; i++) {
    const ini = addMonths(inicioJanela, i)
    const mes = format(ini, 'yyyy-MM')
    const delMes = movs.filter(m => m.data.slice(0, 7) === mes)
    const datas = [...new Set(delMes.map(m => m.data))].sort()
    meses.push({
      mes,
      saldoInicialCentavos: saldoFim(ymd(addDays(ini, -1))),
      entradasCentavos: delMes.filter(m => m.tipo === 'entrada').reduce((s, m) => s + m.valorCentavos, 0),
      saidasCentavos: delMes.filter(m => m.tipo === 'saida').reduce((s, m) => s + m.valorCentavos, 0),
      saldoFinalCentavos: saldoFim(ymd(endOfMonth(ini))),
      situacao: mes < mesHoje ? 'realizado' : mes === mesHoje ? 'atual' : 'previsto',
      dias: datas.map(data => ({
        data,
        movimentos: delMes.filter(m => m.data === data).map(({ tipo, descricao, valorCentavos, previsto }) => ({ tipo, descricao, valorCentavos, previsto })),
        saldoFinalCentavos: saldoFim(data),
      })),
    })
  }

  // --- Menor saldo de hoje até o fim da janela (empate: data mais cedo) ---
  const datasMenor = new Set<string>([hoje])
  for (const dt of deltas.keys()) if (dt > hoje && dt <= fimStr) datasMenor.add(dt)
  let menor = { valorCentavos: saldoFim(hoje), data: hoje }
  for (const dt of [...datasMenor].sort()) {
    const v = saldoFim(dt)
    if (v < menor.valorCentavos) menor = { valorCentavos: v, data: dt }
  }

  return {
    meses,
    saldoHojeCentavos: saldoFim(hoje),
    saldoFinalPrevistoCentavos: saldoFim(fimStr),
    menorSaldo: menor,
    emAtraso: { totalCentavos: atrasoTotal, quantidade: atrasoQtd },
    semSaldoInformado,
  }
}
