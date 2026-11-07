import { describe, it, expect, vi } from 'vitest'
import { fakeAdmin } from '../fakeSupabase'

const mocks = vi.hoisted(() => ({
  createAiDeps: vi.fn(() => ({ marker: 'aiDeps' })),
  getAiForClinic: vi.fn(async () => null),
}))
vi.mock('@/lib/ia/repo', () => ({ createAiDeps: mocks.createAiDeps, recordUsage: vi.fn() }))
vi.mock('@/lib/ia/conexao', () => ({ getAiForClinic: mocks.getAiForClinic }))

import { createAgentDeps, upsertConversation } from '@/lib/agente/repo'

describe('upsertConversation', () => {
  it('trata conflito do índice único relendo', async () => {
    const updates: Record<string, unknown>[] = []
    const existing = { id: 'c9', patient_id: null }
    const admin = {
      from: vi.fn(() => ({
        insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: '23505', message: 'dup' } }) }) }),
        select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: existing, error: null }) }) }) }),
        update: (v: Record<string, unknown>) => {
          updates.push(v)
          return { eq: async () => ({ error: null }) }
        },
      })),
    }
    const at = new Date('2026-11-06T15:00:00Z')
    const id = await upsertConversation(admin as never, 'k1', '5511999990000', 'p1', at)
    expect(id).toBe('c9')
    expect(updates[0]).toEqual({ last_message_at: at.toISOString(), unread: true, patient_id: 'p1' })
  })

  it('insere nova conversa sem atualizar', async () => {
    const update = vi.fn()
    const admin = {
      from: () => ({
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'new' }, error: null }) }) }),
        update,
      }),
    }
    expect(await upsertConversation(admin as never, 'k1', '55', null, new Date())).toBe('new')
    expect(update).not.toHaveBeenCalled()
  })
})

describe('createAgentDeps', () => {
  it('getAi usa timeout de 20 s e sem novas tentativas', async () => {
    const { admin } = fakeAdmin()
    await createAgentDeps(admin).getAi('k1')
    expect(mocks.createAiDeps).toHaveBeenCalledWith(admin, { timeoutMs: 20_000, maxRetries: 0 })
    expect(mocks.getAiForClinic).toHaveBeenCalledWith('k1', { marker: 'aiDeps' })
  })

  it('history mascara cobranças e orçamentos', async () => {
    const rows = [
      { direction: 'out', type: 'charge', body: 'Pague R$ 300' },
      { direction: 'in', type: 'incoming', body: 'oi' },
    ]
    const { admin } = fakeAdmin(() => ({ data: rows, error: null }))
    expect(await createAgentDeps(admin).history('k1', '5511')).toEqual([
      { role: 'paciente', body: 'oi' },
      { role: 'automatica', body: '[mensagem automática de cobrança ou orçamento]' },
    ])
  })

  it('lastActivityBefore considera só mensagens enviadas ou recebidas', async () => {
    const { admin, queries } = fakeAdmin(() => ({ data: { created_at: '2026-11-06T10:00:00Z' }, error: null }))
    expect(await createAgentDeps(admin).lastActivityBefore('k1', '5511', 'm1')).toBe('2026-11-06T10:00:00Z')
    expect(queries[0].calls).toContainEqual(['in', 'status', ['sent', 'received']])
    expect(queries[0].calls).toContainEqual(['neq', 'id', 'm1'])
  })
})
