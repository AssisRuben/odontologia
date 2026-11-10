// Validação dos corpos das rotas de estoque.

import { dataValida } from '@/lib/convenios/cadastro'
import { isUuid } from '@/lib/ia/uuid'
import { KINDS_ENTRADA, KINDS_SAIDA } from './rotulos'

type Falha = { ok: false; error: string }

function objeto(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
}

const vazio = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

/** Texto opcional aparado; vazio vira null. undefined em caso de tipo errado. */
function texto(v: unknown): string | null | undefined {
  if (vazio(v)) return null
  return typeof v === 'string' ? v.trim() : undefined
}

const inteiroNaoNegativo = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0
const inteiroPositivo = (v: unknown): v is number => inteiroNaoNegativo(v) && v > 0

const DADOS = { ok: false, error: 'Dados inválidos' } as const satisfies Falha
const QTD = { ok: false, error: 'Quantidade inválida' } as const satisfies Falha

/** Lote (código) e validade opcionais, compartilhados por produto e entrada. */
function loteEValidade(o: Record<string, unknown>): { lotCode: string | null; expiresAt: string | null } | Falha {
  const lotCode = texto(o.lotCode)
  const expiresAt = texto(o.expiresAt)
  if (lotCode === undefined || expiresAt === undefined) return DADOS
  if (lotCode && lotCode.length > 40) return { ok: false, error: 'Lote muito longo' }
  if (expiresAt && !dataValida(expiresAt)) return { ok: false, error: 'Data inválida' }
  return { lotCode, expiresAt }
}

export type ProdutoInput = {
  name: string
  category: string | null
  unit: string | null
  minQuantity: number
  idealQuantity: number | null
  supplier: string | null
  trackExpiry: boolean
}

export function parseProduto(
  raw: unknown,
  criacao: boolean,
):
  | { ok: true; input: ProdutoInput & { active?: boolean; initialQuantity?: number; lotCode?: string | null; expiresAt?: string | null } }
  | Falha {
  const o = objeto(raw)
  if (!o) return DADOS
  const name = typeof o.name === 'string' ? o.name.trim() : ''
  if (name === '') return { ok: false, error: 'Informe o nome' }
  if (name.length > 80) return { ok: false, error: 'Nome muito longo' }
  const category = texto(o.category)
  const unit = texto(o.unit)
  const supplier = texto(o.supplier)
  if (category === undefined || unit === undefined || supplier === undefined) return DADOS
  if (category && category.length > 40) return { ok: false, error: 'Categoria muito longa' }
  if (unit && unit.length > 40) return { ok: false, error: 'Unidade muito longa' }
  if (supplier && supplier.length > 80) return { ok: false, error: 'Fornecedor muito longo' }

  let minQuantity = 0
  if (!vazio(o.minQuantity)) {
    if (!inteiroNaoNegativo(o.minQuantity)) return QTD
    minQuantity = o.minQuantity
  }
  let idealQuantity: number | null = null
  if (!vazio(o.idealQuantity)) {
    if (!inteiroNaoNegativo(o.idealQuantity)) return QTD
    idealQuantity = o.idealQuantity
  }
  if (o.trackExpiry !== undefined && typeof o.trackExpiry !== 'boolean') return DADOS
  if (!criacao && typeof o.trackExpiry !== 'boolean') return DADOS

  const input: ProdutoInput & { active?: boolean; initialQuantity?: number; lotCode?: string | null; expiresAt?: string | null } = {
    name, category, unit, minQuantity, idealQuantity, supplier, trackExpiry: o.trackExpiry === true,
  }

  if (criacao) {
    if (!vazio(o.initialQuantity)) {
      if (!inteiroNaoNegativo(o.initialQuantity)) return QTD
      input.initialQuantity = o.initialQuantity
    }
    const l = loteEValidade(o)
    if ('ok' in l) return l
    if (input.initialQuantity !== undefined || l.lotCode || l.expiresAt) {
      input.lotCode = l.lotCode
      input.expiresAt = l.expiresAt
    }
  } else {
    // Edição: o SQL substitui todos os campos, então active é obrigatório.
    if (typeof o.active !== 'boolean') return DADOS
    input.active = o.active
  }
  return { ok: true, input }
}

export type EntradaInput = {
  quantity: number
  kind: 'compra' | 'devolucao' | 'ajuste'
  lotCode: string | null
  expiresAt: string | null
  notes: string | null
  totalCostCents: number | null
  payment: { status: 'paid'; method: string; date: string } | { status: 'pending'; dueDate: string } | null
}

const FORMAS = ['dinheiro', 'cartao_credito', 'cartao_debito', 'pix', 'boleto']

export function parseEntrada(raw: unknown): { ok: true; input: EntradaInput } | Falha {
  const o = objeto(raw)
  if (!o) return DADOS
  const kind = KINDS_ENTRADA.find((k) => k === o.kind)
  if (!kind) return DADOS
  if (!inteiroPositivo(o.quantity)) return QTD
  const l = loteEValidade(o)
  if ('ok' in l) return l
  const notes = texto(o.notes)
  if (notes === undefined) return DADOS
  if (notes && notes.length > 500) return { ok: false, error: 'Observação muito longa' }

  let totalCostCents: number | null = null
  let payment: EntradaInput['payment'] = null
  // Só compra gera despesa; nos demais tipos custo e pagamento são descartados.
  if (kind === 'compra' && o.totalCostCents !== undefined && o.totalCostCents !== null) {
    const c = o.totalCostCents
    if (typeof c !== 'number' || !Number.isInteger(c) || c <= 0 || c > 9999999999) return { ok: false, error: 'Valor inválido' }
    totalCostCents = c
    const p = objeto(o.payment)
    if (!p || (p.status !== 'paid' && p.status !== 'pending')) return { ok: false, error: 'Informe se a compra já foi paga' }
    if (p.status === 'paid') {
      if (typeof p.method !== 'string' || !FORMAS.includes(p.method)) return { ok: false, error: 'Informe a forma de pagamento' }
      if (typeof p.date !== 'string' || !dataValida(p.date)) return { ok: false, error: 'Data inválida' }
      payment = { status: 'paid', method: p.method, date: p.date }
    } else {
      if (vazio(p.dueDate)) return { ok: false, error: 'Informe o vencimento' }
      if (typeof p.dueDate !== 'string' || !dataValida(p.dueDate)) return { ok: false, error: 'Data inválida' }
      payment = { status: 'pending', dueDate: p.dueDate }
    }
  }

  return { ok: true, input: { quantity: o.quantity, kind, lotCode: l.lotCode, expiresAt: l.expiresAt, notes, totalCostCents, payment } }
}

export type SaidaInput = { quantity: number; kind: 'uso' | 'perda' | 'vencido'; lotId: string | null; notes: string | null }

/** lotId opcional: vazio vira null, valor que não seja UUID é inválido. */
function idOpcional(v: unknown): string | null | undefined {
  if (vazio(v)) return null
  return isUuid(v) ? v : undefined
}

export function parseSaida(raw: unknown): { ok: true; input: SaidaInput } | Falha {
  const o = objeto(raw)
  if (!o) return DADOS
  const kind = KINDS_SAIDA.find((k) => k === o.kind)
  if (!kind) return DADOS
  const lotId = idOpcional(o.lotId)
  if (lotId === undefined) return DADOS
  if (!inteiroPositivo(o.quantity)) return QTD
  const notes = texto(o.notes)
  if (notes === undefined) return DADOS
  if (notes && notes.length > 500) return { ok: false, error: 'Observação muito longa' }
  return { ok: true, input: { quantity: o.quantity, kind, lotId, notes } }
}

export type ContagemInput = { counted: number; lotId: string | null; notes: string | null }

export function parseContagem(raw: unknown): { ok: true; input: ContagemInput } | Falha {
  const o = objeto(raw)
  if (!o) return DADOS
  const lotId = idOpcional(o.lotId)
  if (lotId === undefined) return DADOS
  if (!inteiroNaoNegativo(o.counted)) return QTD
  const notes = texto(o.notes)
  if (notes === undefined) return DADOS
  if (notes && notes.length > 500) return { ok: false, error: 'Observação muito longa' }
  return { ok: true, input: { counted: o.counted, lotId, notes } }
}
