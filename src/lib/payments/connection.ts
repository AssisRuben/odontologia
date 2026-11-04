import { randomBytes } from 'node:crypto'
import { PaymentProviderError, type PaymentProvider } from './provider'

export type Environment = 'sandbox' | 'production'

/** Conexão como gravada (com a chave): só para uso interno do servidor. */
export type StoredConnection = { api_key: string; environment: Environment; webhook_id: string | null }

export type ConnectionDeps = {
  makeProvider(apiKey: string, environment: Environment): Pick<PaymentProvider, 'verifyKey' | 'registerWebhook' | 'removeWebhook'>
  webhookUrl(): string
  /** 64 caracteres hex aleatórios (injetável nos testes). */
  randomHex(): string
  getStored(clinicId: string): Promise<StoredConnection | null>
  saveConnection(row: Record<string, unknown>): Promise<void>
  deleteConnection(clinicId: string): Promise<void>
  /** false quando a clínica não tem conexão. */
  updateConnection(clinicId: string, patch: Record<string, unknown>): Promise<boolean>
}

export type Fail = { ok: false; status: number; error: string }

const INTERNAL = 'Erro interno. Tente novamente.'

// O Asaas rejeita tokens com dígitos sequenciais (ex.: 0123).
const ASCENDING_RUN = /0123|1234|2345|3456|4567|5678|6789/

export const defaultRandomHex = (): string => randomBytes(32).toString('hex')

export function generateWebhookToken(randomHex: () => string = defaultRandomHex): string {
  for (let i = 0; i < 1000; i++) {
    const t = randomHex()
    if (!ASCENDING_RUN.test(t)) return t
  }
  throw new Error('Não foi possível gerar o token do webhook')
}

export function toApiError(e: unknown): { status: number; error: string } {
  if (e instanceof PaymentProviderError) {
    if (e.kind === 'invalid_key') return { status: 409, error: 'asaas_invalid_key' }
    if (e.kind === 'validation') return { status: 422, error: e.message }
    if (e.kind === 'unavailable') {
      return { status: 503, error: 'O Asaas não respondeu. Nada foi alterado. Tente novamente.' }
    }
  }
  return { status: 500, error: INTERNAL }
}

export async function connect(
  input: { clinicId: string; apiKey: string; environment: Environment },
  deps: ConnectionDeps,
): Promise<{ ok: true; accountName: string } | Fail> {
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''
  if (input.environment !== 'sandbox' && input.environment !== 'production') {
    return { ok: false, status: 422, error: 'Ambiente inválido' }
  }
  if (!apiKey) return { ok: false, status: 422, error: 'Informe a chave do Asaas' }

  const provider = deps.makeProvider(apiKey, input.environment)
  let accountName: string
  try {
    accountName = (await provider.verifyKey()).accountName
  } catch (e) {
    if (e instanceof PaymentProviderError && e.kind === 'invalid_key') {
      return { ok: false, status: 422, error: 'Chave inválida para o ambiente escolhido' }
    }
    return { ok: false, ...toApiError(e) }
  }

  const token = generateWebhookToken(deps.randomHex)
  let webhookId: string
  try {
    webhookId = (await provider.registerWebhook(deps.webhookUrl(), token)).webhookId
  } catch (e) {
    return { ok: false, ...toApiError(e) }
  }

  try {
    const previous = await deps.getStored(input.clinicId)
    await deps.saveConnection({
      clinic_id: input.clinicId,
      provider: 'asaas',
      environment: input.environment,
      api_key: apiKey,
      api_key_last4: apiKey.slice(-4),
      account_name: accountName,
      webhook_id: webhookId,
      webhook_token: token,
      status: 'connected',
      updated_at: new Date().toISOString(),
    })
    if (previous?.webhook_id) await removeQuietly(previous, deps)
  } catch (e) {
    console.error('[payments/connection] falha ao gravar a conexão:', (e as Error).message)
    await provider.removeWebhook(webhookId).catch(() => {})
    return { ok: false, status: 500, error: INTERNAL }
  }
  return { ok: true, accountName }
}

async function removeQuietly(stored: StoredConnection, deps: ConnectionDeps): Promise<void> {
  if (!stored.webhook_id) return
  try {
    await deps.makeProvider(stored.api_key, stored.environment).removeWebhook(stored.webhook_id)
  } catch {
    // webhook antigo órfão não impede a troca/desconexão
  }
}

export async function disconnect(clinicId: string, deps: ConnectionDeps): Promise<{ ok: true } | Fail> {
  const stored = await deps.getStored(clinicId)
  if (stored) await removeQuietly(stored, deps)
  await deps.deleteConnection(clinicId)
  return { ok: true }
}

export type SettingsPatch = {
  fine_percent?: number
  interest_percent_month?: number
  nfse_auto?: boolean
  nfse_description?: string
  nfse_service_code?: string
  nfse_iss_rate?: number | null
}

const inRange = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max
const fail = (error: string): Fail => ({ ok: false, status: 422, error })

export async function updateSettings(
  clinicId: string,
  patch: SettingsPatch,
  deps: ConnectionDeps,
): Promise<{ ok: true } | Fail> {
  const clean: Record<string, unknown> = {}
  if (patch.fine_percent !== undefined) {
    if (!inRange(patch.fine_percent, 2)) return fail('A multa deve ficar entre 0% e 2%')
    clean.fine_percent = patch.fine_percent
  }
  if (patch.interest_percent_month !== undefined) {
    if (!inRange(patch.interest_percent_month, 1)) return fail('Os juros devem ficar entre 0% e 1% ao mês')
    clean.interest_percent_month = patch.interest_percent_month
  }
  if (patch.nfse_iss_rate !== undefined) {
    if (patch.nfse_iss_rate !== null && !inRange(patch.nfse_iss_rate, 5)) return fail('O ISS deve ficar entre 0% e 5%')
    clean.nfse_iss_rate = patch.nfse_iss_rate
  }
  if (patch.nfse_auto !== undefined) {
    if (typeof patch.nfse_auto !== 'boolean') return fail('Valor inválido para emissão automática')
    clean.nfse_auto = patch.nfse_auto
  }
  for (const k of ['nfse_description', 'nfse_service_code'] as const) {
    const v = patch[k]
    if (v === undefined) continue
    if (typeof v !== 'string' || !v.trim()) return fail('Preencha a descrição e o código do serviço')
    clean[k] = v.trim()
  }
  if (Object.keys(clean).length === 0) return fail('Nada para atualizar')
  clean.updated_at = new Date().toISOString()
  const found = await deps.updateConnection(clinicId, clean)
  if (!found) return { ok: false, status: 404, error: 'Conexão não encontrada' }
  return { ok: true }
}

/** Monta a resposta do GET a partir da linha: copia só campos públicos (nunca api_key/webhook_token). */
export function buildConnectionResponse(
  row: Record<string, unknown> | null,
  fiscal: { configured: boolean; missing: string[] } | null,
) {
  if (!row) return { connected: false }
  return {
    connected: true,
    environment: row.environment,
    accountName: row.account_name ?? null,
    apiKeyLast4: row.api_key_last4,
    status: row.status,
    fine_percent: row.fine_percent,
    interest_percent_month: row.interest_percent_month,
    nfse_auto: row.nfse_auto,
    nfse_description: row.nfse_description,
    nfse_service_code: row.nfse_service_code,
    nfse_iss_rate: row.nfse_iss_rate,
    fiscal,
  }
}
