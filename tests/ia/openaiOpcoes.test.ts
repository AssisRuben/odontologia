import { describe, it, expect, vi, beforeEach } from 'vitest'

const ctor = vi.hoisted(() => vi.fn())
vi.mock('openai', async (importOriginal) => {
  const orig = await importOriginal<typeof import('openai')>()
  return { ...orig, default: vi.fn(function (this: unknown, opts: unknown) { ctor(opts); return {} }) }
})

import { makeAiClient } from '@/lib/ia/openai'
import { AI_TIMEOUT_MS, WA_AI_TIMEOUT_MS } from '@/lib/ia/modelos'

describe('makeAiClient: opções do SDK', () => {
  beforeEach(() => ctor.mockClear())

  it('padrão do editor: 60 s e 1 nova tentativa', () => {
    makeAiClient('k')
    expect(ctor).toHaveBeenCalledWith({ apiKey: 'k', timeout: AI_TIMEOUT_MS, maxRetries: 1 })
  })

  it('caminho do WhatsApp: 20 s e sem novas tentativas', () => {
    expect(WA_AI_TIMEOUT_MS).toBe(20_000)
    makeAiClient('k', undefined, { timeoutMs: WA_AI_TIMEOUT_MS, maxRetries: 0 })
    expect(ctor).toHaveBeenCalledWith({ apiKey: 'k', timeout: 20_000, maxRetries: 0 })
  })
})
