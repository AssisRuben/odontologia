import { describe, it, expect, vi } from 'vitest'
import { saveAiConnection, getAiForClinic, getAiView, type AiDeps } from '@/lib/ia/conexao'
import { AiError } from '@/lib/ia/erros'
import type { AiClient } from '@/lib/ia/openai'

const SECRET = 'sk-test-SEGREDO-abcd'

function makeDeps(over: Partial<AiDeps> = {}, stored: Awaited<ReturnType<AiDeps['getStored']>> = null) {
  const client = { transcribe: vi.fn(), organize: vi.fn(), testKey: vi.fn().mockResolvedValue(undefined) } as unknown as AiClient
  const deps: AiDeps = {
    getStored: vi.fn().mockResolvedValue(stored),
    save: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    listUsage: vi.fn().mockResolvedValue([]),
    makeClient: vi.fn().mockReturnValue(client),
    ...over,
  }
  return { deps, client }
}

describe('saveAiConnection', () => {
  it('chave inválida não grava', async () => {
    const { deps, client } = makeDeps()
    ;(client.testKey as ReturnType<typeof vi.fn>).mockRejectedValue(new AiError('invalid_key'))
    const r = await saveAiConnection('c1', { apiKey: SECRET }, deps)
    expect(r).toEqual({ ok: false, status: 422, error: 'Chave inválida' })
    expect(deps.save).not.toHaveBeenCalled()
  })

  it('outro erro vira aiErrorResponse', async () => {
    const { deps, client } = makeDeps()
    ;(client.testKey as ReturnType<typeof vi.fn>).mockRejectedValue(new AiError('rate_limited'))
    const r = await saveAiConnection('c1', { apiKey: SECRET }, deps)
    expect(r).toMatchObject({ ok: false, status: 429 })
    expect(deps.save).not.toHaveBeenCalled()
  })

  it('chave válida grava os 4 últimos', async () => {
    const { deps } = makeDeps()
    const r = await saveAiConnection('c1', { apiKey: `  ${SECRET}  `, modelTier: 'caprichado' }, deps)
    expect(r).toEqual({ ok: true })
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({
      clinic_id: 'c1', api_key: SECRET, api_key_last4: 'abcd', model_tier: 'caprichado',
    }))
  })

  it('troca só de modelo sem conexão → 422', async () => {
    const { deps } = makeDeps()
    const r = await saveAiConnection('c1', { modelTier: 'caprichado' }, deps)
    expect(r).toEqual({ ok: false, status: 422, error: 'Informe a chave da OpenAI' })
    expect(deps.save).not.toHaveBeenCalled()
  })

  it('troca só de modelo com conexão mantém a chave e não testa', async () => {
    const { deps } = makeDeps({}, { api_key: SECRET, api_key_last4: 'abcd', model_tier: 'economico' })
    const r = await saveAiConnection('c1', { apiKey: '  ', modelTier: 'caprichado' }, deps)
    expect(r).toEqual({ ok: true })
    expect(deps.makeClient).not.toHaveBeenCalled()
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ api_key: SECRET, api_key_last4: 'abcd', model_tier: 'caprichado' }))
  })

  it('modelo inválido → 422', async () => {
    const { deps } = makeDeps()
    const r = await saveAiConnection('c1', { apiKey: SECRET, modelTier: 'turbo' }, deps)
    expect(r).toEqual({ ok: false, status: 422, error: 'Modelo inválido' })
    expect(deps.save).not.toHaveBeenCalled()
  })
})

describe('getAiForClinic', () => {
  it('sem conexão devolve null', async () => {
    const { deps } = makeDeps()
    expect(await getAiForClinic('c1', deps)).toBeNull()
  })
  it('usa TEXT_MODELS[model_tier]', async () => {
    const { deps, client } = makeDeps({}, { api_key: SECRET, api_key_last4: 'abcd', model_tier: 'caprichado' })
    const r = await getAiForClinic('c1', deps)
    expect(r).toEqual({ client, model: 'gpt-6.1-terra' })
    expect(deps.makeClient).toHaveBeenCalledWith(SECRET)
  })
})

describe('getAiView', () => {
  it('não expõe a chave', async () => {
    const { deps } = makeDeps({}, { api_key: SECRET, api_key_last4: 'abcd', model_tier: 'economico' })
    const view = await getAiView('c1', deps, new Date('2026-11-15T12:00:00Z'))
    expect(JSON.stringify(view)).not.toContain(SECRET)
    expect(view).toMatchObject({ conectado: true, last4: 'abcd', modelTier: 'economico' })
    expect(deps.listUsage).toHaveBeenCalledWith('c1', '2026-11-01T03:00:00.000Z')
  })
  it('sem conexão', async () => {
    const { deps } = makeDeps()
    const view = await getAiView('c1', deps, new Date())
    expect(view).toMatchObject({ conectado: false, last4: null, modelTier: 'economico' })
  })
})
