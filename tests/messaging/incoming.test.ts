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
    saveIncoming: vi.fn<IncomingDeps['saveIncoming']>(async () => 'in1' as string | null),
    recentConfirmations: vi.fn(async () => [conf]),
    setAppointmentStatus: vi.fn<IncomingDeps['setAppointmentStatus']>(async () => true),
    setReplyAction: vi.fn(async () => {}),
    sendAutoReply: vi.fn<IncomingDeps['sendAutoReply']>(async () => {}),
    updateConnection: vi.fn(async () => {}),
    agentEnabled: vi.fn(async () => false),
    transcribeAudio: vi.fn<IncomingDeps['transcribeAudio']>(async () => ({ ok: true, text: 'transcrito' })),
    upsertConversation: vi.fn<IncomingDeps['upsertConversation']>(async () => 'conv1'),
    outgoingKnown: vi.fn<IncomingDeps['outgoingKnown']>(async () => false),
    saveHumanFromPhone: vi.fn<IncomingDeps['saveHumanFromPhone']>(async () => {}),
    setHandler: vi.fn<IncomingDeps['setHandler']>(async () => {}),
    markRead: vi.fn<IncomingDeps['markRead']>(async () => {}),
    lastIncomingAt: vi.fn<IncomingDeps['lastIncomingAt']>(async () => null),
    sleep: vi.fn(async () => {}),
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
    expect((await handleIncoming(incoming('1'), d, now)).result).toBe('confirmed')
    expect(d.setAppointmentStatus).toHaveBeenCalledWith('c1', 'a1', 'confirmed')
    expect(d.setReplyAction).toHaveBeenCalledWith('in1', 'confirmed', 'a1')
    const arg = d.sendAutoReply.mock.calls[0][0]
    expect(arg.body).toBe('Consulta confirmada! Até quarta, 04/11 às 11:00.')
    expect(arg).toMatchObject({ clinicId: 'c1', patientId: 'p1', phone: '5511987654321', appointmentId: 'a1' })
  })

  it('2 cancela a consulta', async () => {
    const d = makeDeps()
    expect((await handleIncoming(incoming('2'), d, now)).result).toBe('cancelled')
    expect(d.setAppointmentStatus).toHaveBeenCalledWith('c1', 'a1', 'cancelled')
    expect(d.setReplyAction).toHaveBeenCalledWith('in1', 'cancelled', 'a1')
    expect(d.sendAutoReply.mock.calls[0][0].body).toBe('Consulta desmarcada. Em breve entraremos em contato para remarcar.')
  })

  it('1 repetido com consulta já confirmada: só grava, sem status/ação/resposta', async () => {
    const d = makeDeps({
      recentConfirmations: vi.fn(async () => [{ ...conf, appointment: { start_time: start, status: 'confirmed' } }]),
    })
    expect((await handleIncoming(incoming('1'), d, now)).result).toBe('stored')
    expect(d.saveIncoming).toHaveBeenCalledTimes(1)
    expect(d.setAppointmentStatus).not.toHaveBeenCalled()
    expect(d.setReplyAction).not.toHaveBeenCalled()
    expect(d.sendAutoReply).not.toHaveBeenCalled()
  })

  it('auto_reply leva o paciente encontrado (ou null)', async () => {
    const d = makeDeps({ findPatientByPhone: vi.fn(async () => null) })
    expect((await handleIncoming(incoming('2'), d, now)).result).toBe('cancelled')
    expect(d.sendAutoReply.mock.calls[0][0].patientId).toBeNull()
  })

  it('número desconhecido (sem paciente e sem confirmação recente) não é gravado', async () => {
    const d = makeDeps({ findPatientByPhone: vi.fn(async () => null), recentConfirmations: vi.fn(async () => []) })
    expect((await handleIncoming(incoming('oi, tudo bem?'), d, now)).result).toBe('ignored')
    expect(d.saveIncoming).not.toHaveBeenCalled()
    expect(d.setAppointmentStatus).not.toHaveBeenCalled()
    expect(d.sendAutoReply).not.toHaveBeenCalled()
  })

  it('número sem paciente mas com confirmação recente é gravado (telefone editado após o envio)', async () => {
    const d = makeDeps({ findPatientByPhone: vi.fn(async () => null) })
    expect((await handleIncoming(incoming('obrigado'), d, now)).result).toBe('stored')
    expect(d.saveIncoming).toHaveBeenCalledWith(expect.objectContaining({ patient_id: null }))
  })

  it('consulta confirmações uma vez só', async () => {
    const d = makeDeps({ findPatientByPhone: vi.fn(async () => null) })
    await handleIncoming(incoming('1'), d, now)
    expect(d.recentConfirmations).toHaveBeenCalledTimes(1)
  })

  it('texto livre só grava a mensagem', async () => {
    const d = makeDeps()
    expect((await handleIncoming(incoming('obrigado'), d, now)).result).toBe('stored')
    expect(d.saveIncoming).toHaveBeenCalledTimes(1)
    expect(d.setAppointmentStatus).not.toHaveBeenCalled()
    expect(d.sendAutoReply).not.toHaveBeenCalled()
  })

  it('1 sem confirmação válida: stored, sem alteração', async () => {
    const d = makeDeps({ recentConfirmations: vi.fn(async () => []) })
    expect((await handleIncoming(incoming('1'), d, now)).result).toBe('stored')
    expect(d.saveIncoming).toHaveBeenCalledTimes(1)
    expect(d.setAppointmentStatus).not.toHaveBeenCalled()
    expect(d.setReplyAction).not.toHaveBeenCalled()
    expect(d.sendAutoReply).not.toHaveBeenCalled()
  })

  it('instância desconhecida é ignorada', async () => {
    const d = makeDeps()
    const ev: WebhookEvent = { ...(incoming('1') as Extract<WebhookEvent, { kind: 'incoming' }>), instance: 'outra' }
    expect((await handleIncoming(ev, d, now)).result).toBe('ignored')
    expect(d.saveIncoming).not.toHaveBeenCalled()
  })

  it('evento de conexão atualiza a conexão', async () => {
    const d = makeDeps()
    const ev: WebhookEvent = { kind: 'connection', instance: 'inst', status: 'connected', phone: '5511999990000' }
    expect((await handleIncoming(ev, d, now)).result).toBe('connection')
    expect(d.updateConnection).toHaveBeenCalledWith('inst', 'connected', '5511999990000')
  })

  it('mensagem duplicada (mesmo provider_message_id) é ignorada', async () => {
    const d = makeDeps({ incomingExists: vi.fn(async () => true) })
    expect((await handleIncoming(incoming('1'), d, now)).result).toBe('ignored')
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

  it('consulta que mudou de estado (update não afetou linha): stored, sem resposta', async () => {
    const d = makeDeps({ setAppointmentStatus: vi.fn(async () => false) })
    expect((await handleIncoming(incoming('1'), d, now)).result).toBe('stored')
    expect(d.setReplyAction).not.toHaveBeenCalled()
    expect(d.sendAutoReply).not.toHaveBeenCalled()
  })

  it('duplicata concorrente (saveIncoming devolve null): ignored', async () => {
    const d = makeDeps({ saveIncoming: vi.fn(async () => null) })
    expect((await handleIncoming(incoming('1'), d, now)).result).toBe('ignored')
    expect(d.setAppointmentStatus).not.toHaveBeenCalled()
  })

  it('falha na resposta automática não desfaz a consulta nem o resultado', async () => {
    const d = makeDeps({ sendAutoReply: vi.fn(async () => { throw new Error('boom') }) })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await handleIncoming(incoming('1'), d, now)).result).toBe('confirmed')
    expect(d.setAppointmentStatus).toHaveBeenCalledWith('c1', 'a1', 'confirmed')
    spy.mockRestore()
  })

  it('grava a mensagem recebida antes de alterar a consulta', async () => {
    const order: string[] = []
    const d = makeDeps({
      saveIncoming: vi.fn(async () => { order.push('save'); return 'in1' }),
      setAppointmentStatus: vi.fn(async () => { order.push('status'); return true }),
    })
    await handleIncoming(incoming('1'), d, now)
    expect(order).toEqual(['save', 'status'])
  })

  it('evento incoming de telefone não normalizável usa o bruto', async () => {
    const d = makeDeps()
    await handleIncoming(incoming('oi', '123'), d, now)
    expect(d.saveIncoming.mock.calls[0][0].phone).toBe('123')
  })

  describe('agente', () => {
    const audio = (seconds: number): WebhookEvent => ({ ...(incoming('') as Extract<WebhookEvent, { kind: 'incoming' }>), audio: { seconds, media: { key: { id: 'pm1' }, message: { audioMessage: {} } } } })
    const outgoing = (text = 'Olá, tudo bem?'): WebhookEvent => ({
      kind: 'outgoing', instance: 'inst', to: '+55 (11) 98765-4321', text, providerMessageId: 'out1', at: now,
    })
    const unknown = { findPatientByPhone: vi.fn(async () => null), recentConfirmations: vi.fn(async () => []) }
    const on = () => vi.fn(async () => true)

    it('"1" que agiu devolve agent null', async () => {
      const d = makeDeps({ agentEnabled: on() })
      expect(await handleIncoming(incoming('1'), d, now)).toEqual({ result: 'confirmed', agent: null })
    })

    it('"1" sem confirmação recente vai para o agente', async () => {
      const d = makeDeps({ agentEnabled: on(), recentConfirmations: vi.fn(async () => []) })
      expect(await handleIncoming(incoming('1'), d, now)).toEqual({ result: 'stored', agent: { conversationId: 'conv1', messageId: 'in1' } })
    })

    it('agente ligado + número desconhecido: guarda e devolve agent', async () => {
      const d = makeDeps({ ...unknown, agentEnabled: on() })
      const r = await handleIncoming(incoming('oi'), d, now)
      expect(r).toEqual({ result: 'stored', agent: { conversationId: 'conv1', messageId: 'in1' } })
      expect(d.saveIncoming).toHaveBeenCalledWith(expect.objectContaining({ patient_id: null, conversation_id: 'conv1', transcribed: false }))
    })

    it('agente desligado: guarda com conversa mas agent null; desconhecido segue ignorado', async () => {
      const d = makeDeps()
      expect(await handleIncoming(incoming('obrigado'), d, now)).toEqual({ result: 'stored', agent: null })
      expect(d.saveIncoming).toHaveBeenCalledWith(expect.objectContaining({ conversation_id: 'conv1' }))
      const d2 = makeDeps(unknown)
      expect((await handleIncoming(incoming('oi'), d2, now)).result).toBe('ignored')
      expect(d2.upsertConversation).not.toHaveBeenCalled()
    })

    it('áudio com agente ligado é transcrito', async () => {
      const d = makeDeps({ agentEnabled: on() })
      await handleIncoming(audio(30), d, now)
      expect(d.transcribeAudio).toHaveBeenCalledWith('c1', 'inst', 't', { key: { id: 'pm1' }, message: { audioMessage: {} } }, 30)
      expect(d.saveIncoming).toHaveBeenCalledWith(expect.objectContaining({ body: 'transcrito', transcribed: true }))
    })

    it('áudio com agente desligado: [áudio], sem transcrever', async () => {
      const d = makeDeps()
      await handleIncoming(audio(30), d, now)
      expect(d.transcribeAudio).not.toHaveBeenCalled()
      expect(d.saveIncoming).toHaveBeenCalledWith(expect.objectContaining({ body: '[áudio]', transcribed: false }))
    })

    it('áudio acima de 300 s: [áudio não transcrito]', async () => {
      const d = makeDeps({ agentEnabled: on() })
      await handleIncoming(audio(301), d, now)
      expect(d.transcribeAudio).not.toHaveBeenCalled()
      expect(d.saveIncoming).toHaveBeenCalledWith(expect.objectContaining({ body: '[áudio não transcrito]', transcribed: false }))
    })

    it('áudio sem chave: [áudio]; com falha: [áudio não transcrito]', async () => {
      const a = makeDeps({ agentEnabled: on(), transcribeAudio: vi.fn(async () => ({ ok: false as const, reason: 'no_key' as const })) })
      await handleIncoming(audio(10), a, now)
      expect(a.saveIncoming).toHaveBeenCalledWith(expect.objectContaining({ body: '[áudio]', transcribed: false }))
      const b = makeDeps({ agentEnabled: on(), transcribeAudio: vi.fn(async () => ({ ok: false as const, reason: 'failed' as const })) })
      await handleIncoming(audio(10), b, now)
      expect(b.saveIncoming).toHaveBeenCalledWith(expect.objectContaining({ body: '[áudio não transcrito]', transcribed: false }))
    })

    it('telefone com máscara cai na mesma conversa', async () => {
      const d = makeDeps({ agentEnabled: on() })
      await handleIncoming(incoming('oi', '+55 (11) 98888-7777'), d, now)
      await handleIncoming(incoming('oi', '5511988887777'), d, now)
      const [a, b] = d.upsertConversation.mock.calls
      expect(a[1]).toBe('5511988887777')
      expect(b[1]).toBe(a[1])
    })

    it('texto de 2500 caracteres é cortado em 2000', async () => {
      const d = makeDeps()
      await handleIncoming(incoming('a'.repeat(2500)), d, now)
      expect(d.saveIncoming.mock.calls[0][0].body).toHaveLength(2000)
    })

    it('outgoing igual a uma mensagem recente do app é ignorado, sem sleep', async () => {
      const d = makeDeps({ agentEnabled: on(), outgoingKnown: vi.fn(async () => true) })
      expect((await handleIncoming(outgoing(), d, now)).result).toBe('ignored')
      expect(d.outgoingKnown).toHaveBeenCalledWith('c1', 'out1', '5511987654321', 'Olá, tudo bem?', new Date(now.getTime() - 60_000))
      expect(d.sleep).not.toHaveBeenCalled()
      expect(d.saveHumanFromPhone).not.toHaveBeenCalled()
      expect(d.setHandler).not.toHaveBeenCalled()
    })

    it('outgoing desconhecido nas duas checagens passa a conversa para a equipe', async () => {
      const d = makeDeps({ agentEnabled: on() })
      expect(await handleIncoming(outgoing(), d, now)).toEqual({ result: 'outgoing', agent: null })
      expect(d.sleep).toHaveBeenCalledWith(3000)
      expect(d.outgoingKnown).toHaveBeenCalledTimes(2)
      expect(d.upsertConversation).toHaveBeenCalledWith('c1', '5511987654321', 'p1', now)
      expect(d.saveHumanFromPhone).toHaveBeenCalledWith('c1', 'conv1', '5511987654321', 'Olá, tudo bem?', 'out1')
      expect(d.setHandler).toHaveBeenCalledWith('conv1', 'human', 'Respondido pelo celular da clínica')
      expect(d.markRead).toHaveBeenCalledWith('conv1')
    })

    it('outgoing desconhecido na primeira e conhecido após o sleep é ignorado', async () => {
      const known = vi.fn<IncomingDeps['outgoingKnown']>().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
      const d = makeDeps({ agentEnabled: on(), outgoingKnown: known })
      expect((await handleIncoming(outgoing(), d, now)).result).toBe('ignored')
      expect(d.sleep).toHaveBeenCalledTimes(1)
      expect(d.saveHumanFromPhone).not.toHaveBeenCalled()
    })

    it('outgoing desconhecido até 10 s após a última recebida (saudação/ausência do WhatsApp Business): grava sem mudar o handler', async () => {
      const d = makeDeps({ agentEnabled: on(), lastIncomingAt: vi.fn(async () => new Date(now.getTime() - 9_000)) })
      expect(await handleIncoming(outgoing(), d, now)).toEqual({ result: 'outgoing', agent: null })
      expect(d.lastIncomingAt).toHaveBeenCalledWith('c1', '5511987654321')
      expect(d.saveHumanFromPhone).toHaveBeenCalledWith('c1', 'conv1', '5511987654321', 'Olá, tudo bem?', 'out1')
      expect(d.setHandler).not.toHaveBeenCalled()
      expect(d.markRead).not.toHaveBeenCalled()
    })

    it('outgoing desconhecido mais de 10 s após a última recebida passa para a equipe', async () => {
      const d = makeDeps({ agentEnabled: on(), lastIncomingAt: vi.fn(async () => new Date(now.getTime() - 10_000)) })
      expect((await handleIncoming(outgoing(), d, now)).result).toBe('outgoing')
      expect(d.saveHumanFromPhone).toHaveBeenCalled()
      expect(d.setHandler).toHaveBeenCalledWith('conv1', 'human', 'Respondido pelo celular da clínica')
      expect(d.markRead).toHaveBeenCalledWith('conv1')
    })

    it('outgoing para número desconhecido com agente desligado é ignorado (privacidade)', async () => {
      const d = makeDeps({ ...unknown })
      expect((await handleIncoming(outgoing(), d, now)).result).toBe('ignored')
      expect(d.saveHumanFromPhone).not.toHaveBeenCalled()
    })
  })
})
