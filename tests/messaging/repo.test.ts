import { describe, it, expect } from 'vitest'
import { createSupabaseQueueRepo } from '@/lib/messaging/repo'
import { fakeAdmin } from '../fakeSupabase'

describe('countSentSince', () => {
  it('conta só mensagens automáticas: exclui respostas do agente e da equipe', async () => {
    const { admin, queries } = fakeAdmin(() => ({ count: 7, error: null }))
    const since = new Date('2026-11-06T03:00:00Z')
    expect(await createSupabaseQueueRepo(admin).countSentSince('k1', since)).toBe(7)
    const calls = queries[0].calls
    expect(calls).toContainEqual(['eq', 'clinic_id', 'k1'])
    expect(calls).toContainEqual(['eq', 'direction', 'out'])
    expect(calls).toContainEqual(['eq', 'status', 'sent'])
    expect(calls).toContainEqual(['gte', 'sent_at', since.toISOString()])
    expect(calls).toContainEqual(['not', 'type', 'in', '(agent,human)'])
  })
})
