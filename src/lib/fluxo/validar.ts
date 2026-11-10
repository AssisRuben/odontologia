// Validação dos corpos das rotas do fluxo de caixa, do saldo informado e das recorrências.

type Falha = { ok: false; error: string }

const DADOS = { ok: false, error: 'Dados inválidos' } as const satisfies Falha

export type SaldoInput = { data: string; valorCentavos: number }
export type RecorrenciaInput = {
  description: string
  amountCentavos: number
  category: string
  deductionGroup: string | null
  paymentMethod: string | null
  dayOfMonth: number
  startMonth: string
  endMonth: string | null
  aPartirDe?: string
}

const CATEGORIAS = [
  'aluguel', 'contas', 'material', 'laboratorio', 'servicos', 'manutencao',
  'marketing', 'conselho', 'iptu_taxas', 'tarifas', 'salarios', 'emolumentos',
  'equipamentos', 'reformas', 'cursos', 'comissoes', 'outras',
]
const GRUPOS = ['custeio', 'pessoal', 'emolumentos']
// Despesas não aceitam 'convenio'.
const FORMAS = ['dinheiro', 'cartao_credito', 'cartao_debito', 'pix', 'boleto']

const MAX_CENTAVOS = 99999999999

function objeto(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
}

function dataValida(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

const mesValido = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)
/** Índice absoluto do mês, para comparar e subtrair. */
const idx = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1

export function parseSaldo(raw: unknown, hoje: string): { ok: true; input: SaldoInput } | Falha {
  const o = objeto(raw)
  if (!o) return DADOS
  if (!dataValida(o.data)) return { ok: false, error: 'Data inválida' }
  if (o.data > hoje) return { ok: false, error: 'A data não pode ser futura' }
  const v = o.valorCentavos
  if (typeof v !== 'number' || !Number.isInteger(v) || Math.abs(v) > MAX_CENTAVOS) {
    return { ok: false, error: 'Valor inválido' }
  }
  return { ok: true, input: { data: o.data, valorCentavos: v } }
}

export function parseRecorrencia(
  raw: unknown,
  modo: 'criar' | 'editar',
  hoje: string,
): { ok: true; input: RecorrenciaInput } | Falha {
  const o = objeto(raw)
  if (!o) return DADOS
  const description = typeof o.description === 'string' ? o.description.trim() : ''
  if (description === '') return { ok: false, error: 'Informe a descrição' }
  if (description.length > 200) return DADOS
  const a = o.amountCentavos
  if (typeof a !== 'number' || !Number.isInteger(a) || a < 1 || a > MAX_CENTAVOS) {
    return { ok: false, error: 'Valor inválido' }
  }
  const d = o.dayOfMonth
  if (typeof d !== 'number' || !Number.isInteger(d) || d < 1 || d > 31) return { ok: false, error: 'Dia inválido' }
  if (typeof o.category !== 'string' || !CATEGORIAS.includes(o.category)) return DADOS
  const g = o.deductionGroup ?? null
  if (g !== null && (typeof g !== 'string' || !GRUPOS.includes(g))) return DADOS
  const m = o.paymentMethod ?? null
  if (m !== null && (typeof m !== 'string' || !FORMAS.includes(m))) return DADOS

  const comum = { description, amountCentavos: a, category: o.category, deductionGroup: g, paymentMethod: m, dayOfMonth: d }

  if (modo === 'editar') {
    if (!mesValido(o.aPartirDe)) return DADOS
    return { ok: true, input: { ...comum, startMonth: '', endMonth: null, aPartirDe: o.aPartirDe } }
  }

  if (!mesValido(o.startMonth)) return { ok: false, error: 'Período inválido' }
  const cur = idx(hoje.slice(0, 7))
  const ini = idx(o.startMonth)
  if (ini < cur - 12 || ini > cur + 12) return { ok: false, error: 'Período inválido' }
  let endMonth: string | null = null
  if (o.endMonth !== undefined && o.endMonth !== null) {
    if (!mesValido(o.endMonth)) return { ok: false, error: 'Período inválido' }
    const fim = idx(o.endMonth)
    if (fim < ini || fim > ini + 120) return { ok: false, error: 'Período inválido' }
    endMonth = o.endMonth
  }
  return { ok: true, input: { ...comum, startMonth: o.startMonth, endMonth } }
}

export function parseEncerrar(raw: unknown): { ok: true; ultimoMes: string } | Falha {
  const o = objeto(raw)
  if (!o || !mesValido(o.ultimoMes)) return DADOS
  return { ok: true, ultimoMes: o.ultimoMes }
}
