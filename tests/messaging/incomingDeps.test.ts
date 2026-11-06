import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeAdmin } from '../fakeSupabase'

const mocks = vi.hoisted(() => ({
  getAiForClinic: vi.fn(),
  getAudio: vi.fn(),
  recordUsage: vi.fn(),
  createAiDeps: vi.fn(() => ({})),
}))
vi.mock('@/lib/ia/conexao', () => ({ getAiForClinic: mocks.getAiForClinic }))
vi.mock('@/lib/ia/repo', () => ({ createAiDeps: mocks.createAiDeps, recordUsage: mocks.recordUsage }))
vi.mock('@/lib/whatsapp', () => ({ getProvider: () => ({ getAudio: mocks.getAudio }) }))

import { createSupabaseIncomingDeps } from '@/lib/messaging/incoming'

const since = new Date('2026-11-06T15:00:00Z')

describe('outgoingKnown', () => {
  it('reconhece pelo telefone e corpo linhas sending (qualquer idade) ou enviadas desde since', async () => {
    const { admin, queries } = fakeAdmin((_q, i) => (i === 0 ? { data: [], error: null } : { data: [{ id: 'x' }], error: null }))
    expect(await createSupabaseIncomingDeps(admin).outgoingKnown('k1', 'pm', '5511', 'oi', since)).toBe(true)
    const calls = queries[1].calls
    expect(calls).toContainEqual(['eq', 'phone', '5511'])
    expect(calls).toContainEqual(['eq', 'body', 'oi'])
    expect(calls).toContainEqual(['in', 'status', ['sending', 'sent']])
    expect(calls).toContainEqual(['or', `status.eq.sending,sent_at.gte.${since.toISOString()}`])
    expect(calls.some((c) => c[1] === 'created_at')).toBe(false)
  })

  it('id já conhecido: não faz a segunda consulta', async () => {
    const { admin, queries } = fakeAdmin(() => ({ data: [{ id: 'x' }], error: null }))
    expect(await createSupabaseIncomingDeps(admin).outgoingKnown('k1', 'pm', '5511', 'oi', since)).toBe(true)
    expect(queries).toHaveLength(1)
  })
})

describe('lastIncomingAt', () => {
  it('devolve a data da última mensagem recebida do telefone', async () => {
    const { admin, queries } = fakeAdmin(() => ({ data: { created_at: '2026-11-06T14:59:55Z' }, error: null }))
    expect(await createSupabaseIncomingDeps(admin).lastIncomingAt('k1', '5511')).toEqual(new Date('2026-11-06T14:59:55Z'))
    const calls = queries[0].calls
    expect(calls).toContainEqual(['eq', 'clinic_id', 'k1'])
    expect(calls).toContainEqual(['eq', 'phone', '5511'])
    expect(calls).toContainEqual(['eq', 'direction', 'in'])
  })

  it('sem mensagem recebida: null', async () => {
    const { admin } = fakeAdmin(() => ({ data: null, error: null }))
    expect(await createSupabaseIncomingDeps(admin).lastIncomingAt('k1', '5511')).toBeNull()
  })
})

const MEDIA = { key: { id: 'pm' }, message: { audioMessage: {} } }

describe('transcribeAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAudio.mockResolvedValue({ bytes: new Uint8Array([1]), mimetype: 'audio/ogg' })
  })

  it('usa timeout de 20 s e sem novas tentativas', async () => {
    mocks.getAiForClinic.mockResolvedValue({ client: { transcribe: async () => 'texto' }, model: 'm' })
    mocks.recordUsage.mockResolvedValue(undefined)
    const { admin } = fakeAdmin()
    await createSupabaseIncomingDeps(admin).transcribeAudio('k1', 'inst', 't', MEDIA, 10)
    expect(mocks.createAiDeps).toHaveBeenCalledWith(admin, { timeoutMs: 20_000, maxRetries: 0 })
  })

  it('falha ao registrar o uso não descarta a transcrição', async () => {
    mocks.getAiForClinic.mockResolvedValue({ client: { transcribe: async () => 'texto' }, model: 'm' })
    mocks.recordUsage.mockRejectedValue(new Error('db'))
    const { admin } = fakeAdmin()
    expect(await createSupabaseIncomingDeps(admin).transcribeAudio('k1', 'inst', 't', MEDIA, 10)).toEqual({ ok: true, text: 'texto' })
  })

  it('falha ao registrar o uso depois de erro na transcrição não lança', async () => {
    mocks.getAiForClinic.mockResolvedValue({ client: { transcribe: async () => { throw new Error('x') } }, model: 'm' })
    mocks.recordUsage.mockRejectedValue(new Error('db'))
    const { admin } = fakeAdmin()
    expect(await createSupabaseIncomingDeps(admin).transcribeAudio('k1', 'inst', 't', MEDIA, 10)).toEqual({ ok: false, reason: 'failed' })
  })
})
