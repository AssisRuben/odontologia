// Validação dos corpos das rotas de prótese e laboratório.

import type { ProstheticStatus } from '@/types'
import { dataValida } from '@/lib/convenios/cadastro'
import { isUuid } from '@/lib/ia/uuid'
import { ehEtapa } from './etapas'

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

export type ProteseInput = {
  patientId: string
  professionalId: string | null
  laboratoryId: string | null
  type: string | null
  toothRegion: string | null
  expectedAt: string | null
  labCostCents: number | null
  notes: string | null
}

export function parseProtese(raw: unknown): { ok: true; input: ProteseInput } | Falha {
  const o = objeto(raw)
  if (!o) return { ok: false, error: 'Dados inválidos' }
  if (vazio(o.patientId)) return { ok: false, error: 'Escolha o paciente' }
  if (!isUuid(o.patientId)) return { ok: false, error: 'Dados inválidos' }
  const ids: Record<'professionalId' | 'laboratoryId', string | null> = { professionalId: null, laboratoryId: null }
  for (const k of ['professionalId', 'laboratoryId'] as const) {
    if (vazio(o[k])) continue
    if (!isUuid(o[k])) return { ok: false, error: 'Dados inválidos' }
    ids[k] = o[k] as string
  }
  const type = texto(o.type)
  const toothRegion = texto(o.toothRegion)
  const notes = texto(o.notes)
  const expectedAt = texto(o.expectedAt)
  if (type === undefined || toothRegion === undefined || notes === undefined || expectedAt === undefined) {
    return { ok: false, error: 'Dados inválidos' }
  }
  if (type && type.length > 80) return { ok: false, error: 'Tipo muito longo' }
  if (toothRegion && toothRegion.length > 40) return { ok: false, error: 'Dente/região muito longo' }
  if (notes && notes.length > 1000) return { ok: false, error: 'Observações muito longas' }
  if (expectedAt && !dataValida(expectedAt)) return { ok: false, error: 'Data inválida' }
  let labCostCents: number | null = null
  if (o.labCostCents !== undefined && o.labCostCents !== null) {
    const c = o.labCostCents
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 0) return { ok: false, error: 'Custo inválido' }
    labCostCents = c
  }
  return {
    ok: true,
    input: { patientId: o.patientId, ...ids, type, toothRegion, expectedAt, labCostCents, notes },
  }
}

export type MoverInput = {
  de: ProstheticStatus
  para: ProstheticStatus
  observacao: string | null
  previsao: string | null
}

export function parseMover(raw: unknown): { ok: true; input: MoverInput } | Falha {
  const o = objeto(raw)
  if (!o || !ehEtapa(o.de) || !ehEtapa(o.para)) return { ok: false, error: 'Dados inválidos' }
  if (o.de === o.para) return { ok: false, error: 'Escolha outra etapa' }
  const observacao = texto(o.observacao)
  const previsao = texto(o.previsao)
  if (observacao === undefined || previsao === undefined) return { ok: false, error: 'Dados inválidos' }
  if (observacao && observacao.length > 300) return { ok: false, error: 'Observação muito longa' }
  if (previsao && !dataValida(previsao)) return { ok: false, error: 'Data inválida' }
  return { ok: true, input: { de: o.de, para: o.para, observacao, previsao } }
}

export type LaboratorioInput = { name: string; phone: string | null; notes: string | null; active?: boolean }

export function parseLaboratorio(raw: unknown): { ok: true; input: LaboratorioInput } | Falha {
  const o = objeto(raw)
  if (!o) return { ok: false, error: 'Dados inválidos' }
  const name = typeof o.name === 'string' ? o.name.trim() : ''
  if (name === '') return { ok: false, error: 'Informe o nome' }
  if (name.length > 80) return { ok: false, error: 'Nome muito longo' }
  const phone = texto(o.phone)
  const notes = texto(o.notes)
  if (phone === undefined || notes === undefined) return { ok: false, error: 'Dados inválidos' }
  if (phone && phone.length > 30) return { ok: false, error: 'Telefone muito longo' }
  if (notes && notes.length > 500) return { ok: false, error: 'Observações muito longas' }
  const input: LaboratorioInput = { name, phone, notes }
  if (typeof o.active === 'boolean') input.active = o.active
  return { ok: true, input }
}

/** Atualização parcial de laboratório: aceita qualquer subconjunto de name/phone/notes/active. */
export function parseLaboratorioParcial(raw: unknown): { ok: true; input: Partial<LaboratorioInput> } | Falha {
  const o = objeto(raw)
  if (!o) return { ok: false, error: 'Dados inválidos' }
  const input: Partial<LaboratorioInput> = {}
  if ('name' in o) {
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    if (name === '') return { ok: false, error: 'Informe o nome' }
    if (name.length > 80) return { ok: false, error: 'Nome muito longo' }
    input.name = name
  }
  if ('phone' in o) {
    const phone = texto(o.phone)
    if (phone === undefined) return { ok: false, error: 'Dados inválidos' }
    if (phone && phone.length > 30) return { ok: false, error: 'Telefone muito longo' }
    input.phone = phone
  }
  if ('notes' in o) {
    const notes = texto(o.notes)
    if (notes === undefined) return { ok: false, error: 'Dados inválidos' }
    if (notes && notes.length > 500) return { ok: false, error: 'Observações muito longas' }
    input.notes = notes
  }
  if ('active' in o) {
    if (typeof o.active !== 'boolean') return { ok: false, error: 'Dados inválidos' }
    input.active = o.active
  }
  if (Object.keys(input).length === 0) return { ok: false, error: 'Dados inválidos' }
  return { ok: true, input }
}
