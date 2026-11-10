// Validação dos corpos das rotas de kits e de baixa por tratamento.

import { isUuid } from '@/lib/ia/uuid'

type Falha = { ok: false; error: string }

const DADOS = { ok: false, error: 'Dados inválidos' } as const satisfies Falha
const QTD = { ok: false, error: 'Quantidade inválida' } as const satisfies Falha

export type ItemKitInput = { itemId: string; quantity: number }
export type KitInput = { name: string; active: boolean; items: ItemKitInput[] }
export type BaixaInput = { kitId: string | null; items: ItemKitInput[] }

function objeto(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
}

function itens(raw: unknown): { ok: true; items: ItemKitInput[] } | Falha {
  if (!Array.isArray(raw)) return DADOS
  if (raw.length === 0) return { ok: false, error: 'Inclua ao menos um produto' }
  if (raw.length > 50) return { ok: false, error: 'Máximo de 50 produtos' }
  const vistos = new Set<string>()
  const items: ItemKitInput[] = []
  for (const r of raw) {
    const o = objeto(r)
    if (!o || !isUuid(o.itemId)) return DADOS
    const q = o.quantity
    if (typeof q !== 'number' || !Number.isInteger(q) || q < 1 || q > 9999) return QTD
    if (vistos.has(o.itemId)) return { ok: false, error: 'Produto repetido na lista' }
    vistos.add(o.itemId)
    items.push({ itemId: o.itemId, quantity: q })
  }
  return { ok: true, items }
}

export function parseKit(raw: unknown, modo: 'criar' | 'editar'): { ok: true; input: KitInput } | Falha {
  const o = objeto(raw)
  if (!o) return DADOS
  const name = typeof o.name === 'string' ? o.name.trim() : ''
  if (name === '') return { ok: false, error: 'Informe o nome do kit' }
  if (name.length > 80) return { ok: false, error: 'Nome muito longo' }
  if (o.active !== undefined && typeof o.active !== 'boolean') return DADOS
  // Edição: o SQL substitui todos os campos, então active é obrigatório.
  if (modo === 'editar' && typeof o.active !== 'boolean') return DADOS
  const l = itens(o.items)
  if (!l.ok) return l
  return { ok: true, input: { name, active: o.active !== false, items: l.items } }
}

export function parseBaixa(raw: unknown): { ok: true; input: BaixaInput } | Falha {
  const o = objeto(raw)
  if (!o) return DADOS
  let kitId: string | null = null
  if (o.kitId !== undefined && o.kitId !== null) {
    if (!isUuid(o.kitId)) return DADOS
    kitId = o.kitId
  }
  const l = itens(o.items)
  if (!l.ok) return l
  return { ok: true, input: { kitId, items: l.items } }
}
