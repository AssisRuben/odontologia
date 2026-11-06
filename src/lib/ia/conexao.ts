import type { AiTier } from '@/types'
import { AiError, aiErrorResponse } from './erros'
import { TEXT_MODELS } from './modelos'
import type { AiClient } from './openai'
import { monthStartIso, summarizeUsage, type UsageRow } from './uso'

export interface AiDeps {
  getStored(clinicId: string): Promise<{ api_key: string; api_key_last4: string; model_tier: AiTier } | null>
  save(row: { clinic_id: string; api_key: string; api_key_last4: string; model_tier: AiTier; updated_at: string }): Promise<void>
  remove(clinicId: string): Promise<void>
  listUsage(clinicId: string, fromIso: string): Promise<UsageRow[]>
  makeClient(apiKey: string): AiClient
}

type SaveResult = { ok: true } | { ok: false; status: number; error: string }

const TIERS: AiTier[] = ['economico', 'caprichado']

export async function saveAiConnection(
  clinicId: string,
  input: { apiKey?: unknown; modelTier?: unknown },
  deps: AiDeps,
): Promise<SaveResult> {
  const stored = await deps.getStored(clinicId)

  let tier: AiTier = stored?.model_tier ?? 'economico'
  if (input.modelTier !== undefined && input.modelTier !== null) {
    if (typeof input.modelTier !== 'string' || !TIERS.includes(input.modelTier as AiTier)) {
      return { ok: false, status: 422, error: 'Modelo inválido' }
    }
    tier = input.modelTier as AiTier
  }

  const newKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''
  let apiKey: string
  let last4: string
  if (newKey) {
    try {
      await deps.makeClient(newKey).testKey()
    } catch (e) {
      const kind = e instanceof AiError ? e.kind : 'unavailable'
      if (kind === 'invalid_key') return { ok: false, status: 422, error: 'Chave inválida' }
      const r = aiErrorResponse(kind)
      return { ok: false, status: r.status, error: r.error }
    }
    apiKey = newKey
    last4 = newKey.slice(-4)
  } else if (stored) {
    apiKey = stored.api_key
    last4 = stored.api_key_last4
  } else {
    return { ok: false, status: 422, error: 'Informe a chave da OpenAI' }
  }

  await deps.save({
    clinic_id: clinicId,
    api_key: apiKey,
    api_key_last4: last4,
    model_tier: tier,
    updated_at: new Date().toISOString(),
  })
  return { ok: true }
}

export async function getAiForClinic(
  clinicId: string,
  deps: AiDeps,
): Promise<{ client: AiClient; model: string } | null> {
  const stored = await deps.getStored(clinicId)
  if (!stored) return null
  return { client: deps.makeClient(stored.api_key), model: TEXT_MODELS[stored.model_tier] }
}

export async function getAiView(clinicId: string, deps: AiDeps, now: Date): Promise<{
  conectado: boolean
  last4: string | null
  modelTier: AiTier
  usoMes: ReturnType<typeof summarizeUsage>
}> {
  const [stored, rows] = await Promise.all([deps.getStored(clinicId), deps.listUsage(clinicId, monthStartIso(now))])
  return {
    conectado: !!stored,
    last4: stored?.api_key_last4 ?? null,
    modelTier: stored?.model_tier ?? 'economico',
    usoMes: summarizeUsage(rows),
  }
}
