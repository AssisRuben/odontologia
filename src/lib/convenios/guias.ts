// Regras puras de criação de guia e de registro da resposta da operadora.

import type { GuideTooth, TreatmentStatus } from '@/types'
import { dataValida } from './cadastro'

type Falha = { ok: false; error: string }

export type TratamentoParaGuia = {
  id: string
  patient_id: string
  insurance_plan_id: string | null
  status: TreatmentStatus
  value: number
  teeth: GuideTooth[]
  procedimento: { code: string; name: string; requires_authorization: boolean } | null
  emGuiaAtiva: boolean
}

export function validarCriacaoGuia(
  input: { patientId: string; insurancePlanId: string; treatmentIds: string[] },
  tratamentos: TratamentoParaGuia[],
): { ok: true } | Falha {
  const ids = input.treatmentIds
  if (ids.length === 0) return { ok: false, error: 'Escolha ao menos um tratamento' }
  if (ids.length > 30) return { ok: false, error: 'Máximo de 30 itens por guia' }

  const porId = new Map(tratamentos.map((t) => [t.id, t]))
  const lista: TratamentoParaGuia[] = []
  for (const id of ids) {
    const t = porId.get(id)
    if (!t) return { ok: false, error: 'Tratamento não encontrado' }
    lista.push(t)
  }

  if (lista.some((t) => t.patient_id !== input.patientId || t.insurance_plan_id !== input.insurancePlanId)) {
    return { ok: false, error: 'Tratamento de outro paciente ou convênio' }
  }
  if (lista.some((t) => t.procedimento === null)) {
    return { ok: false, error: 'Tratamento fora da tabela do convênio' }
  }
  if (lista.some((t) => t.status === 'cancelled')) return { ok: false, error: 'Tratamento cancelado' }
  if (lista.some((t) => t.emGuiaAtiva)) return { ok: false, error: 'Tratamento já está em outra guia' }
  return { ok: true }
}

export type ItemNovo = {
  treatment_id: string
  code: string
  name: string
  teeth: GuideTooth[]
  value: number
  requires_authorization: boolean
  authorization: 'pendente' | 'nao_exige'
}

/** Pressupõe tratamentos já validados (procedimento não nulo); os sem procedimento são ignorados. */
export function montarItens(tratamentos: TratamentoParaGuia[]): ItemNovo[] {
  const itens: ItemNovo[] = []
  for (const t of tratamentos) {
    if (!t.procedimento) continue
    itens.push({
      treatment_id: t.id,
      code: t.procedimento.code,
      name: t.procedimento.name,
      teeth: t.teeth,
      value: t.value,
      requires_authorization: t.procedimento.requires_authorization,
      authorization: t.procedimento.requires_authorization ? 'pendente' : 'nao_exige',
    })
  }
  return itens
}

export function statusInicial(itens: ItemNovo[]): 'aguardando' | 'liberada' {
  return itens.some((i) => i.authorization === 'pendente') ? 'aguardando' : 'liberada'
}

export type RespostaGuia = {
  guideNumber: string | null
  password: string | null
  passwordValidUntil: string | null
  itens: { id: string; authorization: 'autorizado' | 'negado'; denialReason: string | null }[]
}

function textoOuNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

export function validarResposta(
  raw: unknown,
  itensDaGuia: { id: string; requires_authorization: boolean }[],
): { ok: true; resposta: RespostaGuia } | Falha {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Dados inválidos' }
  const o = raw as Record<string, unknown>

  const guideNumber = textoOuNull(o.guideNumber)
  if (guideNumber !== null && guideNumber.length > 40) return { ok: false, error: 'Número da guia muito longo' }

  const password = textoOuNull(o.password)
  if (password !== null && password.length > 40) return { ok: false, error: 'Senha muito longa' }

  const passwordValidUntil = textoOuNull(o.passwordValidUntil)
  if (passwordValidUntil !== null && !dataValida(passwordValidUntil)) return { ok: false, error: 'Data inválida' }

  const brutos = o.itens === undefined || o.itens === null ? [] : o.itens
  if (!Array.isArray(brutos)) return { ok: false, error: 'Dados inválidos' }

  const porId = new Map(itensDaGuia.map((i) => [i.id, i]))
  const itens: RespostaGuia['itens'] = []
  for (const b of brutos) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return { ok: false, error: 'Dados inválidos' }
    const it = b as Record<string, unknown>
    const doBanco = typeof it.id === 'string' ? porId.get(it.id) : undefined
    if (!doBanco) return { ok: false, error: 'Item não pertence à guia' }
    if (!doBanco.requires_authorization) return { ok: false, error: 'Item não exige autorização' }
    if (it.authorization !== 'autorizado' && it.authorization !== 'negado') return { ok: false, error: 'Dados inválidos' }

    let denialReason: string | null = null
    if (it.authorization === 'negado') {
      denialReason = textoOuNull(it.denialReason)
      if (denialReason === null) return { ok: false, error: 'Informe o motivo da negativa' }
      if (denialReason.length > 200) return { ok: false, error: 'Motivo muito longo' }
    }
    itens.push({ id: doBanco.id, authorization: it.authorization, denialReason })
  }

  return { ok: true, resposta: { guideNumber, password, passwordValidUntil, itens } }
}
