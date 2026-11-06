import { describe, expect, it, vi } from 'vitest'
import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  InternalServerError,
  PermissionDeniedError,
  RateLimitError,
} from 'openai'
import { z } from 'zod'
import { makeAiClient, toAiError } from '@/lib/ia/openai'
import { AiError } from '@/lib/ia/erros'

function fakeSdk(over: { create?: unknown; parse?: unknown; list?: unknown } = {}) {
  const create = vi.fn((over.create ?? (async () => ({ text: 'olá mundo' }))) as () => Promise<unknown>)
  const parse = vi.fn((over.parse ?? (async () => ({ output_parsed: { a: 1 }, usage: { input_tokens: 10, output_tokens: 5 } }))) as () => Promise<unknown>)
  const list = vi.fn((over.list ?? (async () => ({}))) as () => Promise<unknown>)
  const sdk = { audio: { transcriptions: { create } }, responses: { parse }, models: { list } } as unknown as OpenAI
  return { sdk, create, parse, list }
}

const schema = z.object({ a: z.number() })
const args = { model: 'gpt-6-luna', schema, name: 'teste', system: 'sys', user: 'usr' }
const h = new Headers()

describe('transcribe', () => {
  it('envia modelo e idioma e devolve o texto', async () => {
    const { sdk, create } = fakeSdk()
    const file = new File(['x'], 'a.webm', { type: 'audio/webm' })
    expect(await makeAiClient('k', sdk).transcribe(file)).toBe('olá mundo')
    expect(create).toHaveBeenCalledWith({ model: 'gpt-transcribe', file, languages: ['pt'] })
  })

  it('converte erros do SDK', async () => {
    const { sdk } = fakeSdk({ create: async () => { throw new RateLimitError(429, {}, 'x', h) } })
    await expect(makeAiClient('k', sdk).transcribe(new File(['x'], 'a.webm'))).rejects.toMatchObject({ kind: 'rate_limited' })
  })
})

describe('organize', () => {
  it('devolve dados e tokens', async () => {
    const { sdk, parse } = fakeSdk()
    const r = await makeAiClient('k', sdk).organize(args)
    expect(r).toEqual({ data: { a: 1 }, inputTokens: 10, outputTokens: 5 })
    expect(parse).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-6-luna',
      input: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'usr' }],
    }))
  })

  it('saída nula vira bad_output', async () => {
    const { sdk } = fakeSdk({ parse: async () => ({ output_parsed: null, usage: {} }) })
    await expect(makeAiClient('k', sdk).organize(args)).rejects.toMatchObject({ kind: 'bad_output' })
  })

  it('erro de validação do zod vira bad_output', async () => {
    const { sdk } = fakeSdk({ parse: async () => { schema.parse({ a: 'x' }) } })
    await expect(makeAiClient('k', sdk).organize(args)).rejects.toMatchObject({ kind: 'bad_output' })
  })
})

describe('testKey', () => {
  it('lista modelos', async () => {
    const { sdk, list } = fakeSdk()
    await makeAiClient('k', sdk).testKey()
    expect(list).toHaveBeenCalled()
  })

  it('chave recusada vira invalid_key', async () => {
    const { sdk } = fakeSdk({ list: async () => { throw new AuthenticationError(401, {}, 'x', h) } })
    await expect(makeAiClient('k', sdk).testKey()).rejects.toMatchObject({ kind: 'invalid_key' })
  })
})

describe('toAiError', () => {
  it('mapeia as classes do SDK', () => {
    expect(toAiError(new AuthenticationError(401, {}, 'x', h)).kind).toBe('invalid_key')
    expect(toAiError(new PermissionDeniedError(403, {}, 'x', h)).kind).toBe('invalid_key')
    expect(toAiError(new RateLimitError(429, {}, 'x', h)).kind).toBe('rate_limited')
    expect(toAiError(new APIConnectionTimeoutError()).kind).toBe('timeout')
    expect(toAiError(new APIConnectionError({})).kind).toBe('unavailable')
    expect(toAiError(new InternalServerError(500, {}, 'x', h)).kind).toBe('unavailable')
    expect(toAiError(new APIError(400, {}, 'x', h)).kind).toBe('unavailable')
  })

  it('AiError passa direto e outros viram unavailable', () => {
    const e = new AiError('bad_output')
    expect(toAiError(e)).toBe(e)
    expect(toAiError(new Error('boom')).kind).toBe('unavailable')
    expect(toAiError('x').kind).toBe('unavailable')
  })
})
