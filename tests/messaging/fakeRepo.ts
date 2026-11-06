import type { QueueRepo, QueuedMessage } from '@/lib/messaging/repo'
import type { MessageStatus } from '@/lib/messaging/types'

export interface FakeMessage {
  id: string
  clinic_id: string
  direction: 'out' | 'in'
  phone: string
  body: string
  status: MessageStatus
  scheduled_for: Date
  expires_at: Date | null
  attempts: number
  sent_at: Date | null
  error: string | null
  provider_message_id: string | null
  type?: string | null
  budget_id?: string | null
}

export class FakeRepo implements QueueRepo {
  rows: FakeMessage[] = []
  releaseStuckCalls: Date[] = []
  clock: () => Date = () => new Date()

  add(p: Partial<FakeMessage> & { id: string }): FakeMessage {
    const row: FakeMessage = {
      clinic_id: 'c1',
      direction: 'out',
      phone: '5511987654321',
      body: 'oi',
      status: 'queued',
      scheduled_for: new Date('2026-11-02T12:00:00Z'),
      expires_at: null,
      attempts: 0,
      sent_at: null,
      error: null,
      provider_message_id: null,
      ...p,
    }
    this.rows.push(row)
    return row
  }

  get(id: string): FakeMessage {
    const r = this.rows.find((x) => x.id === id)
    if (!r) throw new Error('missing ' + id)
    return r
  }

  async releaseStuck(clinicId: string, olderThan: Date) {
    this.releaseStuckCalls.push(olderThan)
    for (const r of this.rows) {
      if (r.clinic_id === clinicId && r.status === 'sending' && r.scheduled_for < olderThan) {
        r.status = 'failed'
        r.error = 'Envio interrompido — confira no WhatsApp antes de reenviar'
      }
    }
  }

  async listDue(clinicId: string, now: Date, limit: number): Promise<QueuedMessage[]> {
    return this.rows
      .filter(
        (r) =>
          r.clinic_id === clinicId &&
          r.direction === 'out' &&
          r.status === 'queued' &&
          r.scheduled_for <= now &&
          (r.expires_at === null || r.expires_at > now),
      )
      .sort((a, b) => a.scheduled_for.getTime() - b.scheduled_for.getTime())
      .slice(0, limit)
      .map((r) => ({ id: r.id, phone: r.phone, body: r.body, attempts: r.attempts, type: r.type ?? null, budget_id: r.budget_id ?? null }))
  }

  /** Atômico: check-and-set síncrono, como o UPDATE ... WHERE status = 'queued'. */
  async lock(id: string) {
    const r = this.rows.find((x) => x.id === id)
    if (!r || r.status !== 'queued') return false
    r.status = 'sending'
    r.attempts += 1
    r.scheduled_for = this.clock()
    return true
  }

  reminderEvents: { clinicId: string; budgetId: string }[] = []
  reminderFailures = 0

  async recordBudgetReminder(clinicId: string, budgetId: string) {
    if (this.reminderFailures > 0) {
      this.reminderFailures--
      throw new Error('events down')
    }
    this.reminderEvents.push({ clinicId, budgetId })
  }

  markSentFailures = 0

  async markSent(id: string, providerMessageId: string, at: Date) {
    if (this.markSentFailures > 0) {
      this.markSentFailures--
      throw new Error('db down')
    }
    const r = this.get(id)
    if (r.status !== 'sending') return
    r.status = 'sent'
    r.provider_message_id = providerMessageId
    r.sent_at = at
    r.error = null
  }

  async markFailed(id: string, error: string) {
    const r = this.get(id)
    if (r.status !== 'sending') return
    r.status = 'failed'
    r.error = error
  }

  async requeue(id: string, attempts: number, at: Date, error: string) {
    const r = this.get(id)
    if (r.status !== 'sending') return
    r.status = 'queued'
    r.attempts = attempts
    r.scheduled_for = at
    r.error = error
  }

  async countSentSince(clinicId: string, since: Date) {
    return this.rows.filter(
      (r) =>
        r.clinic_id === clinicId &&
        r.direction === 'out' &&
        r.status === 'sent' &&
        r.type !== 'agent' &&
        r.type !== 'human' &&
        r.sent_at !== null &&
        r.sent_at >= since,
    ).length
  }
}
