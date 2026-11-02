import { describe, expect, it, vi } from 'vitest'
import { handleIncoming, type IncomingDeps } from '@/lib/messaging/incoming'
import type { SentConfirmation } from '@/lib/messaging/replies'
import type { WebhookEvent } from '@/lib/whatsapp'

const now = new Date('2026-11-03T13:00:00Z')
const start = '2026-11-04T14:00:00Z' // 11:00 em São Paulo
const cfg = { window_start: '08:00', window_end: '20:00', daily_limit: 100, timezone: 'America/Sao_Paulo' }

const conf: SentConfirmation = {
  message_id: 'm1',
  appointment_id: 'a1',
  sent_at: '2026-11-03T12:00:00Z',
  dedupe_key: `confirmation:a1:${start}`,
  appointment: { start_time: start, status: 'scheduled' },
}

function makeDeps(over: Partial<IncomingDeps> = {}) {
  const base = {
    findClinicByInstance: vi.fn(async (i: string) => (i === 'inst' ? { clinicId: 'c1', token: 't', cfg } : null)),
    findPatientByPhone: vi.fn(async () => 'p1' as string | null),
    incomingExists: vi.fn(async () => false),
    saveIncoming: vi.fn<IncomingDeps['saveIncoming']>(async () => 'in1'),
    recentConfirmations: vi.fn(async () => [conf]),
    setAppointmentStatus: vi.fn(async () => {}),
    setReplyAction: vi.fn(async () => {}),
    sendAutoReply: vi.fn<IncomingDeps['sendAutoReply']>(async () => {}),
    updateConnection: vi.fn(async () => {}),
  }
  const deps: IncomingDeps = { ...base, ...over }
  return deps as typeof base
}

const incoming = (text: string, from = '5511987654321'): WebhookEvent => ({
  kind: 'incoming', instance: 'inst', from, text, providerMessageId: 'pm1', at: now,
})

describe('handleIncoming', () => {
  it('1 com confirmação válida confirma a consulta', async () => {
    const d = makeDeps()
    expect(await handleIncoming(incoming('1'), d, now)).toBe('confirmed')
    expect(d.setAppointmentStatus).toHaveBeenCalledWith('a1', 'confirmed')
    expect(d.setReplyAction).toHaveBeenCalledWith('in1', 'confirmed')
    const arg = d.sendAutoReply.mock.calls[0][0]
    expect(arg.body).toBe('Consulta confirmada! Até quarta, 04/11 às 11:00.')
    expect(arg).toMatchObject({ clinicId: 'c1', phone: '5511987654321', appointmentId: 'a1' })
  })

  it('2 cancela a consulta', async () => {
    const d = makeDeps()
    expect(await handleIncoming(incoming('2'), d, now)).toBe('cancelled')
    expect(d.setAppointmentStatus).toHaveBeenCalledWith('a1', 'cancelled')
    expect(d.setReplyAction).toHaveBeenCalledWith('in1', 'cancelled')
    expect(d.sendAutoReply.mock.calls[0][0].body).toBe('Consulta desmarcada. Em breve entraremos em contato para remarcar.')
  })

  it('texto livre só grava a mensagem', async () => {
    const d = makeDeps()
    expect(await handleIncoming(incoming('obrigado'), d, now)).toBe('stored')
    expect(d.saveIncoming).toHaveBeenCalledTimes(1)
    expect(d.setAppointmentStatus).not.toHaveBeenCalled()
    expect(d.sendAutoReply).not.toHaveBeenCalled()
  })

  it('1 sem confirmação válida: stored, sem alteração', async () => {
    const d = makeDeps({ recentConfirmations: vi.fn(async () => []) })
    expect(await handleIncoming(incoming('1'), d, now)).toBe('stored')
    expect(d.saveIncoming).toHaveBeenCalledTimes(1)
    expect(d.setAppointmentStatus).not.toHaveBeenCalled()
    expect(d.setReplyAction).not.toHaveBeenCalled()
    expect(d.sendAutoReply).not.toHaveBeenCalled()
  })

  it('instância desconhecida é ignorada', async () => {
    const d = makeDeps()
    const ev: WebhookEvent = { ...(incoming('1') as Extract<WebhookEvent, { kind: 'incoming' }>), instance: 'outra' }
    expect(await handleIncoming(ev, d, now)).toBe('ignored')
    expect(d.saveIncoming).not.toHaveBeenCalled()
  })

  it('evento de conexão atualiza a conexão', async () => {
    const d = makeDeps()
    const ev: WebhookEvent = { kind: 'connection', instance: 'inst', status: 'connected', phone: '5511999990000' }
    expect(await handleIncoming(ev, d, now)).toBe('connection')
    expect(d.updateConnection).toHaveBeenCalledWith('inst', 'connected', '5511999990000')
  })

  it('mensagem duplicada (mesmo provider_message_id) é ignorada', async () => {
    const d = makeDeps({ incomingExists: vi.fn(async () => true) })
    expect(await handleIncoming(incoming('1'), d, now)).toBe('ignored')
    expect(d.incomingExists).toHaveBeenCalledWith('c1', 'pm1')
    expect(d.saveIncoming).not.toHaveBeenCalled()
    expect(d.setAppointmentStatus).not.toHaveBeenCalled()
  })

  it('telefone sem o 9 acha paciente cadastrado como (11) 98765-4321', async () => {
    const { findPatientByPhoneIn } = await import('@/lib/messaging/incoming')
    const patients = [{ id: 'p9', whatsapp: null, phone: '(11) 98765-4321', created_at: '2026-01-01' }]
    expect(findPatientByPhoneIn(patients, '551187654321', new Map())).toBe('p9')
  })

  it('vários pacientes: vence o da confirmação mais recente, senão o mais antigo', async () => {
    const { findPatientByPhoneIn } = await import('@/lib/messaging/incoming')
    const patients = [
      { id: 'b', whatsapp: '(11) 98765-4321', phone: null, created_at: '2026-02-01' },
      { id: 'a', whatsapp: null, phone: '11987654321', created_at: '2026-01-01' },
      { id: 'x', whatsapp: '11911112222', phone: null, created_at: '2025-01-01' },
    ]
    expect(findPatientByPhoneIn(patients, '5511987654321', new Map())).toBe('a')
    expect(findPatientByPhoneIn(patients, '5511987654321', new Map([['b', '2026-11-03T10:00:00Z']]))).toBe('b')
    expect(findPatientByPhoneIn(patients, '5511000000000', new Map())).toBeNull()
  })

  it('evento incoming de telefone não normalizável usa o bruto', async () => {
    const d = makeDeps()
    await handleIncoming(incoming('oi', '123'), d, now)
    expect(d.saveIncoming.mock.calls[0][0].phone).toBe('123')
  })
})
