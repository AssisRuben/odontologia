import { describe, it, expect, vi } from 'vitest'
import { upsertConversation } from '@/lib/agente/repo'

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
