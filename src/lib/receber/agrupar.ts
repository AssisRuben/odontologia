import { differenceInCalendarDays, parseISO } from 'date-fns'
import type { Payment } from '@/types'
import { dataSaoPaulo } from '@/lib/fluxo/calcular'

export type TipoReceber = 'todos' | 'boleto' | 'link' | 'cartao' | 'manual'
export type Lembrete = { payment_id: string; type: string; sent_at: string }
export type UltimoLembrete = { data: string; tipo: 'automatico' | 'manual' }
export type ItemReceber = {
  pagamento: Payment
  diasAtraso: number | null
  ultimoLembrete: UltimoLembrete | null
}
export type Totais = { totalCentavos: number; quantidade: number }
export type Receber = {
  grupos: { atraso: ItemReceber[]; proximos: ItemReceber[]; depois: ItemReceber[] }
  totais: { atraso: Totais; proximos: Totais; total: Totais }
  vazio: boolean
}

const LIMITE_PROXIMOS_DIAS = 7

export function tipoDe(p: Payment): Exclude<TipoReceber, 'todos'> {
  if (p.charge_kind === 'carne') return 'boleto'
  if (p.charge_kind === 'cartao_parcelado') return 'cartao'
  if (p.charge_kind === 'avulsa') return p.payment_method === 'boleto' ? 'boleto' : 'link'
  return 'manual'
}

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function somar(itens: ItemReceber[]): Totais {
  return {
    totalCentavos: itens.reduce((s, i) => s + Math.round(i.pagamento.amount * 100), 0),
    quantidade: itens.length,
  }
}

export function agruparReceber(e: {
  hoje: string
  pagamentos: Payment[]
  lembretes: Lembrete[]
  filtro: { busca: string; tipo: TipoReceber }
}): Receber {
  const busca = normalizar(e.filtro.busca)
  const hoje = parseISO(e.hoje)

  // Último lembrete de cada cobrança (o de sent_at mais recente)
  const ultimos = new Map<string, Lembrete>()
  for (const l of e.lembretes) {
    const atual = ultimos.get(l.payment_id)
    if (!atual || l.sent_at > atual.sent_at) ultimos.set(l.payment_id, l)
  }

  const atraso: ItemReceber[] = []
  const proximos: ItemReceber[] = []
  const depois: ItemReceber[] = []

  for (const p of e.pagamentos) {
    if (e.filtro.tipo !== 'todos' && tipoDe(p) !== e.filtro.tipo) continue
    if (busca && !normalizar(p.patient?.name ?? '').includes(busca)) continue

    const l = ultimos.get(p.id)
    const ultimoLembrete: UltimoLembrete | null = l
      ? { data: dataSaoPaulo(l.sent_at), tipo: l.type === 'manual' ? 'manual' : 'automatico' }
      : null

    if (!p.due_date) {
      depois.push({ pagamento: p, diasAtraso: null, ultimoLembrete })
      continue
    }
    const dias = differenceInCalendarDays(hoje, parseISO(p.due_date))
    const item: ItemReceber = { pagamento: p, diasAtraso: dias > 0 ? dias : null, ultimoLembrete }
    if (dias > 0) atraso.push(item)
    else if (-dias <= LIMITE_PROXIMOS_DIAS) proximos.push(item)
    else depois.push(item)
  }

  const porVenc = (a: ItemReceber, b: ItemReceber) => {
    const da = a.pagamento.due_date
    const db = b.pagamento.due_date
    if (!da && !db) return 0
    if (!da) return 1
    if (!db) return -1
    return da < db ? -1 : da > db ? 1 : 0
  }
  atraso.sort(porVenc)
  proximos.sort(porVenc)
  depois.sort(porVenc)

  const total = somar([...atraso, ...proximos, ...depois])
  return {
    grupos: { atraso, proximos, depois },
    totais: { atraso: somar(atraso), proximos: somar(proximos), total },
    vazio: total.quantidade === 0,
  }
}
