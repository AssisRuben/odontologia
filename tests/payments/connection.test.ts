import { describe, expect, it, vi } from 'vitest'
import {
  connect, disconnect, updateSettings, toApiError, buildConnectionResponse, generateWebhookToken,
  type ConnectionDeps, type StoredConnection,
} from '@/lib/payments/connection'
import { markInvalidKey } from '@/lib/payments/repo'
import { PaymentProviderError } from '@/lib/payments/provider'

function setup(o: {
  verify?: () => Promise<{ accountName: string }>
  existing?: StoredConnection | null
  saveFails?: boolean
  removeFails?: boolean
} = {}) {
  const calls = {
    saved: [] as Record<string, unknown>[],
    registered: [] as { url: string; token: string }[],
    removed: [] as { key: string; id: string }[],
    deleted: [] as string[],
    updated: [] as Record<string, unknown>[],
  }
  const deps: ConnectionDeps = {
    makeProvider: (apiKey) => ({
      verifyKey: o.verify ?? (async () => ({ accountName: 'Clínica X' })),
      registerWebhook: async (url: string, token: string) => {
        calls.registered.push({ url, token })
        return { webhookId: 'wh_new' }
      },
      removeWebhook: async (id: string) => {
        calls.removed.push({ key: apiKey, id })
        if (o.removeFails) throw new PaymentProviderError('unavailable', 'x')
      },
    }),
    webhookUrl: () => 'https://app.test/api/webhooks/asaas',
    randomHex: () => 'ab'.repeat(32),
    getStored: async () => o.existing ?? null,
    saveConnection: async (row) => {
      if (o.saveFails) throw new Error('db down')
      calls.saved.push(row)
    },
    deleteConnection: async (id) => { calls.deleted.push(id) },
    updateConnection: async (_id, patch) => { calls.updated.push(patch); return true },
  }
  return { deps, calls }
}

const input = { clinicId: 'c1', apiKey: '$aact_key_1234', environment: 'sandbox' as const }

describe('connect', () => {
  it('connect verifies key, registers webhook with 64-hex token, saves last4', async () => {
    const { deps, calls } = setup()
    const r = await connect(input, deps)
    expect(r).toEqual({ ok: true, accountName: 'Clínica X' })
    expect(calls.registered).toHaveLength(1)
    expect(calls.registered[0].token).toMatch(/^[0-9a-f]{64}$/)
    expect(calls.registered[0].url).toBe('https://app.test/api/webhooks/asaas')
    expect(calls.saved[0]).toMatchObject({
      clinic_id: 'c1', provider: 'asaas', environment: 'sandbox', api_key: '$aact_key_1234',
      api_key_last4: '1234', account_name: 'Clínica X', webhook_id: 'wh_new',
      webhook_token: calls.registered[0].token, status: 'connected',
    })
  })

  it("connect with invalid key returns 422 'Chave inválida para o ambiente escolhido' and saves nothing", async () => {
    const { deps, calls } = setup({ verify: async () => { throw new PaymentProviderError('invalid_key', 'no') } })
    const r = await connect(input, deps)
    expect(r).toEqual({ ok: false, status: 422, error: 'Chave inválida para o ambiente escolhido' })
    expect(calls.saved).toHaveLength(0)
    expect(calls.registered).toHaveLength(0)
  })

  it('rejects empty key and bad environment', async () => {
    const { deps } = setup()
    expect(await connect({ ...input, apiKey: '  ' }, deps)).toEqual({ ok: false, status: 422, error: 'Informe a chave do Asaas' })
    expect(await connect({ ...input, environment: 'x' as never }, deps)).toEqual({ ok: false, status: 422, error: 'Ambiente inválido' })
  })

  it('if saving fails after registerWebhook, removes the webhook', async () => {
    const { deps, calls } = setup({ saveFails: true })
    const r = await connect(input, deps)
    expect(r.ok).toBe(false)
    expect(calls.removed).toEqual([{ key: '$aact_key_1234', id: 'wh_new' }])
  })

  it('reconnect removes old webhook', async () => {
    const { deps, calls } = setup({
      existing: { api_key: 'old_key_0000', environment: 'production', webhook_id: 'wh_old' },
    })
    const r = await connect(input, deps)
    expect(r.ok).toBe(true)
    expect(calls.removed).toEqual([{ key: 'old_key_0000', id: 'wh_old' }])
  })

  it('generated webhook token has no 4-digit ascending run', () => {
    const bad = 'a1234' + 'b'.repeat(59)
    const good = 'c'.repeat(64)
    const seq = [bad, good]
    let n = 0
    expect(generateWebhookToken(() => seq[n++])).toBe(good)
    expect(n).toBe(2)
  })
})

describe('disconnect', () => {
  it('disconnect ignores removeWebhook failure and deletes row', async () => {
    const { deps, calls } = setup({
      removeFails: true,
      existing: { api_key: 'k', environment: 'sandbox', webhook_id: 'wh_old' },
    })
    const r = await disconnect('c1', deps)
    expect(r).toEqual({ ok: true })
    expect(calls.removed).toHaveLength(1)
    expect(calls.deleted).toEqual(['c1'])
  })
})

describe('updateSettings', () => {
  it('updateSettings rejects fine 3', async () => {
    const { deps, calls } = setup()
    const r = await updateSettings('c1', { fine_percent: 3 }, deps)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(422)
    expect(calls.updated).toHaveLength(0)
  })

  it('saves valid values and ignores unknown keys', async () => {
    const { deps, calls } = setup()
    const r = await updateSettings('c1', { fine_percent: 2, interest_percent_month: 1, nfse_iss_rate: 5, api_key: 'evil' } as never, deps)
    expect(r).toEqual({ ok: true })
    expect(calls.updated[0]).toMatchObject({ fine_percent: 2, interest_percent_month: 1, nfse_iss_rate: 5 })
    expect(calls.updated[0]).not.toHaveProperty('api_key')
  })
})

describe('GET / errors', () => {
  it('GET never includes api_key or webhook_token', () => {
    const row = {
      clinic_id: 'c1', provider: 'asaas', environment: 'sandbox', api_key: 'SECRET', webhook_token: 'TOKEN',
      api_key_last4: '1234', account_name: 'X', webhook_id: 'w', status: 'connected', fine_percent: 2,
      interest_percent_month: 1, nfse_auto: false, nfse_description: 'd', nfse_service_code: '4.12', nfse_iss_rate: null,
    }
    const body = buildConnectionResponse(row, null)
    const s = JSON.stringify(body)
    expect(s).not.toContain('SECRET')
    expect(s).not.toContain('TOKEN')
    expect(body).toMatchObject({ connected: true, apiKeyLast4: '1234', accountName: 'X', fiscal: null })
    expect(buildConnectionResponse(null, null)).toMatchObject({ connected: false })
  })

  it('returns 409 asaas_invalid_key and flags connection', async () => {
    const e = toApiError(new PaymentProviderError('invalid_key', 'x'))
    expect(e).toEqual({ status: 409, error: 'asaas_invalid_key' })
    expect(toApiError(new PaymentProviderError('validation', 'Campo X'))).toEqual({ status: 422, error: 'Campo X' })
    expect(toApiError(new PaymentProviderError('unavailable', 'x'))).toEqual({
      status: 503, error: 'O Asaas não respondeu. Nada foi alterado. Tente novamente.',
    })
    const eq2 = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn(() => ({ eq: eq2 }))
    const admin = { from: vi.fn(() => ({ update })) }
    await markInvalidKey(admin as never, 'c1')
    expect(admin.from).toHaveBeenCalledWith('payment_connections')
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'invalid_key' }))
    expect(eq2).toHaveBeenCalledWith('clinic_id', 'c1')
  })
})
