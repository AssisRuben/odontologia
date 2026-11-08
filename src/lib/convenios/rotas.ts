// Validação de corpos e tradução de erros do banco para as rotas de guias e lotes.

import { isUuid } from '@/lib/ia/uuid'
import { dataValida } from './cadastro'

type Falha = { ok: false; error: string }

function objeto(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
}

export function parseCriarGuia(raw: unknown):
  | { ok: true; input: { patientId: string; insurancePlanId: string; professionalId: string | null; treatmentIds: string[] } }
  | Falha {
  const o = objeto(raw)
  if (!o) return { ok: false, error: 'Dados inválidos' }
  if (!isUuid(o.patientId) || !isUuid(o.insurancePlanId)) return { ok: false, error: 'Dados inválidos' }
  let professionalId: string | null = null
  if (o.professionalId !== undefined && o.professionalId !== null && o.professionalId !== '') {
    if (!isUuid(o.professionalId)) return { ok: false, error: 'Profissional inválido' }
    professionalId = o.professionalId
  }
  if (!Array.isArray(o.treatmentIds) || !o.treatmentIds.every(isUuid)) return { ok: false, error: 'Dados inválidos' }
  const treatmentIds = [...new Set(o.treatmentIds as string[])]
  if (treatmentIds.length === 0) return { ok: false, error: 'Escolha ao menos um tratamento' }
  if (treatmentIds.length > 30) return { ok: false, error: 'Máximo de 30 itens por guia' }
  return { ok: true, input: { patientId: o.patientId, insurancePlanId: o.insurancePlanId, professionalId, treatmentIds } }
}

export function parseExecutado(raw: unknown): { ok: true; executedAt: string } | Falha {
  const o = objeto(raw)
  if (!o || typeof o.executedAt !== 'string' || !dataValida(o.executedAt)) return { ok: false, error: 'Data inválida' }
  return { ok: true, executedAt: o.executedAt }
}

export function parseEnvio(raw: unknown): { ok: true; protocol: string; sentAt: string } | Falha {
  const o = objeto(raw)
  if (!o) return { ok: false, error: 'Dados inválidos' }
  const protocol = typeof o.protocol === 'string' ? o.protocol.trim() : ''
  if (protocol === '') return { ok: false, error: 'Informe o protocolo' }
  if (protocol.length > 60) return { ok: false, error: 'Protocolo muito longo' }
  if (typeof o.sentAt !== 'string' || !dataValida(o.sentAt)) return { ok: false, error: 'Data inválida' }
  return { ok: true, protocol, sentAt: o.sentAt }
}

export function parseItemLote(raw: unknown): { ok: true; acao: { typed: boolean } | { remover: true } } | Falha {
  const o = objeto(raw)
  if (!o) return { ok: false, error: 'Dados inválidos' }
  if (o.remover === true) return { ok: true, acao: { remover: true } }
  if (typeof o.typed === 'boolean') return { ok: true, acao: { typed: o.typed } }
  return { ok: false, error: 'Dados inválidos' }
}

const ERROS: Record<string, { status: number; error: string }> = {
  GUIA_INVALIDA: { status: 404, error: 'Guia não encontrada' },
  GUIA_CANCELADA: { status: 409, error: 'Guia cancelada' },
  GUIA_EM_LOTE: { status: 409, error: 'Guia com item em lote não pode ser alterada' },
  LOTE_INVALIDO: { status: 404, error: 'Lote não encontrado' },
  LOTE_ENVIADO: { status: 409, error: 'Lote já enviado' },
  LOTE_VAZIO: { status: 409, error: 'Lote vazio' },
  ITEM_EM_LOTE: { status: 409, error: 'Item em lote não pode ser alterado' },
}

export function erroDoBanco(e: { code?: string; message?: string }): { status: number; error: string } | null {
  if (e?.code === '23505') return { status: 409, error: 'Tratamento já está em outra guia' }
  return (e?.message && ERROS[e.message]) || null
}

/** Converte erro conhecido do banco em resposta; qualquer outro é relançado (vira 500). */
export function respostaDeErro(e: unknown): { status: number; body: { error: string } } {
  const m = erroDoBanco((e ?? {}) as { code?: string; message?: string })
  if (!m) throw e
  return { status: m.status, body: { error: m.error } }
}
