// Validação das entradas de pagamento de lote, recurso, resultado e recebimento de recurso.

import { dataValida } from '../cadastro'
import { paraCentavos, deCentavos } from './calculo'

type Falha = { ok: false; error: string; status: 422 }
const falha = (error: string): Falha => ({ ok: false, error, status: 422 })

export type ItemPagamento = { id: string; paidValue: number; glosaCode: string | null; glosaNote: string | null }

const obj = (raw: unknown): Record<string, unknown> =>
  raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}

/** Número finito com no máximo 2 casas decimais; senão null. */
function dinheiro(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const c = Math.round(v * 100)
  if (Math.abs(v * 100 - c) > 1e-6) return null
  return deCentavos(c)
}

const data = (v: unknown): string | null => (typeof v === 'string' && dataValida(v) ? v : null)

export function validarPagamento(
  raw: unknown,
  itensDoLote: { id: string; value: number }[],
): { ok: true; dados: { paidAt: string; deposit: number; itens: ItemPagamento[] } } | Falha {
  const r = obj(raw)
  const paidAt = data(r.paidAt)
  if (!paidAt) return falha('Data inválida')
  const deposit = dinheiro(r.deposit)
  if (deposit === null || deposit < 0) return falha('Valor depositado inválido')

  const lista = Array.isArray(r.itens) ? r.itens : []
  const ids = new Set<string>()
  for (const x of lista) {
    const id = obj(x).id
    if (typeof id !== 'string' || ids.has(id)) return falha('Informe todos os itens do lote')
    ids.add(id)
  }
  const doLote = new Map(itensDoLote.map((i) => [i.id, i.value]))
  if (ids.size !== doLote.size || [...ids].some((id) => !doLote.has(id))) {
    return falha('Informe todos os itens do lote')
  }

  const itens: ItemPagamento[] = []
  for (const x of lista) {
    const o = obj(x)
    const id = o.id as string
    const enviado = paraCentavos(doLote.get(id)!)
    const paidValue = dinheiro(o.paidValue)
    if (paidValue === null || paidValue < 0 || paraCentavos(paidValue) > enviado) {
      return falha('Valor pago inválido')
    }
    if (paraCentavos(paidValue) === enviado) {
      itens.push({ id, paidValue, glosaCode: null, glosaNote: null })
      continue
    }
    const code = typeof o.glosaCode === 'string' ? o.glosaCode.trim() : ''
    if (!/^\d{4}$/.test(code)) return falha('Informe o motivo da glosa')
    const note = typeof o.glosaNote === 'string' ? o.glosaNote.trim() : ''
    if (note.length > 200) return falha('Observação muito longa')
    itens.push({ id, paidValue, glosaCode: code, glosaNote: note || null })
  }
  return { ok: true, dados: { paidAt, deposit, itens } }
}

export function validarRecurso(
  raw: unknown,
): { ok: true; dados: { appealAt: string; appealText: string } } | Falha {
  const r = obj(raw)
  const appealAt = data(r.appealAt)
  if (!appealAt) return falha('Data inválida')
  const appealText = typeof r.appealText === 'string' ? r.appealText.trim() : ''
  if (appealText.length < 1 || appealText.length > 2000) return falha('Informe a justificativa')
  return { ok: true, dados: { appealAt, appealText } }
}

export function validarResultado(
  raw: unknown,
  glosaValue: number,
): {
  ok: true
  dados: { resultado: 'aceito' | 'negado'; resultAt: string; recoveredValue: number | null; receivedAt: string | null }
} | Falha {
  const r = obj(raw)
  if (r.resultado !== 'aceito' && r.resultado !== 'negado') return falha('Resultado inválido')
  const resultAt = data(r.resultAt)
  if (!resultAt) return falha('Data inválida')
  if (r.resultado === 'negado') {
    return { ok: true, dados: { resultado: 'negado', resultAt, recoveredValue: null, receivedAt: null } }
  }
  const recoveredValue = dinheiro(r.recoveredValue)
  if (recoveredValue === null || recoveredValue <= 0 || paraCentavos(recoveredValue) > paraCentavos(glosaValue)) {
    return falha('Valor recuperado inválido')
  }
  let receivedAt: string | null = null
  if (r.receivedAt !== undefined && r.receivedAt !== null && r.receivedAt !== '') {
    receivedAt = data(r.receivedAt)
    if (!receivedAt) return falha('Data inválida')
  }
  return { ok: true, dados: { resultado: 'aceito', resultAt, recoveredValue, receivedAt } }
}

export function validarRecebimento(
  raw: unknown,
  recoveredValue: number,
): { ok: true; dados: { value: number; receivedAt: string } } | Falha {
  const r = obj(raw)
  const receivedAt = data(r.receivedAt)
  if (!receivedAt) return falha('Data inválida')
  const value = r.value === undefined || r.value === null ? recoveredValue : dinheiro(r.value)
  if (value === null || value <= 0 || paraCentavos(value) > paraCentavos(recoveredValue)) {
    return falha('Valor recuperado inválido')
  }
  return { ok: true, dados: { value, receivedAt } }
}
