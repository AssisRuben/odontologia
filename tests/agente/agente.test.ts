import { describe, it, expect, vi } from 'vitest'
import { runAgent, simulateAgent, type AgentDeps, type AgentConversation } from '@/lib/agente/agente'
import { AiError } from '@/lib/ia/erros'
import { REASON_FLOOD, REASON_OPT_OUT } from '@/lib/agente/conversa'

const NOW = new Date('2026-11-06T15:00:00Z')
const conv: AgentConversation = {
  id: 'c1', clinic_id: 'k1', phone: '5511999990000', patient_id: null, contact_name: null,
  handler: 'agent', last_message_at: '2026-11-06T14:59:00Z',
}
type Out = { acao: string; resposta: string; nome: string | null; motivo: string | null }
const reply: Out = { acao: 'responder', resposta: 'Olá!', nome: null, motivo: null }

function make(over: Partial<AgentDeps> = {}, out: Out | Error = reply) {
  const organize = vi.fn(async () => {
    if (out instanceof Error) throw out
    return { data: out, inputTokens: 100, outputTokens: 20 }
  })
  const deps = {
    sleep: vi.fn(async () => {}),
    loadConversation: vi.fn(async () => conv),
    latestIncomingId: vi.fn(async () => 'm1'),
    loadClinic: vi.fn(async () => ({
      name: 'Clínica', address: null, phone: null, insurances: [],
      config: { enabled: true, hours: {}, info: '' }, timezone: 'America/Sao_Paulo', whatsappConnected: true,
    })),
    loadPatient: vi.fn(async () => null),
    nextAppointments: vi.fn(async () => []),
    history: vi.fn(async () => [{ role: 'paciente' as const, body: 'oi' }]),
    agentRepliesSince: vi.fn(async () => 0),
    getAi: vi.fn(async () => ({ client: { organize } as never, model: 'gpt-x' })),
    setHandler: vi.fn(async () => {}),
    setContactName: vi.fn(async () => {}),
    markUnread: vi.fn(async () => {}),
    markRead: vi.fn(async () => {}),
    lastActivityBefore: vi.fn(async () => '2026-11-06T14:00:00Z'),
    sendAgentMessage: vi.fn(async () => true),
    recordUsage: vi.fn(async () => {}),
    ...over,
  } as unknown as AgentDeps & Record<string, ReturnType<typeof vi.fn>>
  return { deps, organize }
}
const run = (d: AgentDeps) => runAgent(d, 'c1', 'm1', () => NOW)

describe('runAgent', () => {
  it('superseded', async () => {
    const { deps } = make({ latestIncomingId: vi.fn(async () => 'm2') })
    expect(await run(deps)).toBe('superseded')
    expect(deps.sleep).toHaveBeenCalledWith(5000)
  })
  it('missing', async () => {
    expect(await run(make({ loadConversation: vi.fn(async () => null) }).deps)).toBe('missing')
  })
  it('disabled (desligado ou desconectado)', async () => {
    const base = { name: 'C', address: null, phone: null, insurances: [], timezone: 'America/Sao_Paulo' }
    expect(await run(make({ loadClinic: vi.fn(async () => ({ ...base, config: { enabled: false, hours: {}, info: '' }, whatsappConnected: true })) }).deps)).toBe('disabled')
    expect(await run(make({ loadClinic: vi.fn(async () => ({ ...base, config: { enabled: true, hours: {}, info: '' }, whatsappConnected: false })) }).deps)).toBe('disabled')
  })
  it('human recente não responde', async () => {
    const { deps } = make({ loadConversation: vi.fn(async () => ({ ...conv, handler: 'human' as const })) })
    expect(await run(deps)).toBe('human')
    expect(deps.sendAgentMessage).not.toHaveBeenCalled()
  })
  it('retomada após 12 h chama setHandler agent antes de responder', async () => {
    const old = { ...conv, handler: 'human' as const, last_message_at: '2026-11-05T20:00:00Z' }
    const calls: string[] = []
    const { deps } = make({
      loadConversation: vi.fn()
        .mockResolvedValueOnce(old)
        .mockResolvedValueOnce({ ...old, handler: 'agent' as const }),
      lastActivityBefore: vi.fn(async () => '2026-11-05T20:00:00Z'),
      setHandler: vi.fn(async () => { calls.push('setHandler') }),
      sendAgentMessage: vi.fn(async () => { calls.push('send'); return true }),
    })
    expect(await run(deps)).toBe('replied')
    expect(deps.setHandler).toHaveBeenCalledWith('c1', 'agent', null)
    expect(calls).toEqual(['setHandler', 'send'])
  })
  it('retomada usa a atividade anterior, não o last_message_at já atualizado', async () => {
    const bumped = { ...conv, handler: 'human' as const, last_message_at: NOW.toISOString() }
    const agentAfter = { ...bumped, handler: 'agent' as const }
    const old = make({
      loadConversation: vi.fn().mockResolvedValueOnce(bumped).mockResolvedValueOnce(agentAfter),
      lastActivityBefore: vi.fn(async () => '2026-11-06T02:00:00Z'),
    })
    expect(await run(old.deps)).toBe('replied')
    expect(old.deps.setHandler).toHaveBeenCalledWith('c1', 'agent', null)
    const recent = make({
      loadConversation: vi.fn(async () => bumped),
      lastActivityBefore: vi.fn(async () => '2026-11-06T14:00:00Z'),
    })
    expect(await run(recent.deps)).toBe('human')
    expect(recent.deps.sendAgentMessage).not.toHaveBeenCalled()
    const none = make({
      loadConversation: vi.fn().mockResolvedValueOnce(bumped).mockResolvedValueOnce(agentAfter),
      lastActivityBefore: vi.fn(async () => null),
    })
    expect(await run(none.deps)).toBe('replied')
  })
  it('unread=false após responder/guardar_nome; mantém em passar_recepcao e erro', async () => {
    const a = make()
    await run(a.deps)
    expect(a.deps.markRead).toHaveBeenCalledWith('c1')
    const b = make({}, { acao: 'guardar_nome', resposta: 'Oi', nome: 'Ze', motivo: null })
    await run(b.deps)
    expect(b.deps.markRead).toHaveBeenCalledWith('c1')
    const c = make({}, { acao: 'passar_recepcao', resposta: 'x', nome: null, motivo: 'm' })
    await run(c.deps)
    expect(c.deps.markRead).not.toHaveBeenCalled()
    const d = make({}, new AiError('timeout'))
    await run(d.deps)
    expect(d.deps.markRead).not.toHaveBeenCalled()
  })
  it('opt_out passa para a equipe sem enviar', async () => {
    const { deps } = make({
      loadConversation: vi.fn(async () => ({ ...conv, patient_id: 'p1' })),
      loadPatient: vi.fn(async () => ({ name: 'Ana', optOut: true })),
    })
    expect(await run(deps)).toBe('opt_out')
    expect(deps.setHandler).toHaveBeenCalledWith('c1', 'human', REASON_OPT_OUT)
    expect(deps.sendAgentMessage).not.toHaveBeenCalled()
  })
  it('limit passa para a equipe sem enviar', async () => {
    const { deps } = make({ agentRepliesSince: vi.fn(async () => 30) })
    expect(await run(deps)).toBe('limit')
    expect(deps.setHandler).toHaveBeenCalledWith('c1', 'human', REASON_FLOOD)
    expect(deps.sendAgentMessage).not.toHaveBeenCalled()
  })
  it('no_key marca como não lida', async () => {
    const { deps } = make({ getAi: vi.fn(async () => null) })
    expect(await run(deps)).toBe('no_key')
    expect(deps.markUnread).toHaveBeenCalledWith('c1')
  })
  it('responder envia e registra uso agente com os tokens', async () => {
    const { deps, organize } = make()
    expect(await run(deps)).toBe('replied')
    expect(deps.sendAgentMessage).toHaveBeenCalledWith(conv, 'Olá!')
    expect(deps.recordUsage).toHaveBeenCalledWith('k1', {
      kind: 'agente', model: 'gpt-x', audio_seconds: null, input_tokens: 100, output_tokens: 20, ok: true,
    })
    expect(organize).toHaveBeenCalledOnce()
  })
  it('guardar_nome grava nome e envia', async () => {
    const { deps } = make({}, { acao: 'guardar_nome', resposta: 'Prazer, Maria!', nome: 'Maria', motivo: null })
    expect(await run(deps)).toBe('named')
    expect(deps.setContactName).toHaveBeenCalledWith('c1', 'Maria')
    expect(deps.sendAgentMessage).toHaveBeenCalled()
  })
  it('passar_recepcao envia e passa para human com motivo', async () => {
    const { deps } = make({}, { acao: 'passar_recepcao', resposta: 'Vou chamar a recepção', nome: null, motivo: 'Quer agendar' })
    expect(await run(deps)).toBe('handed_off')
    expect(deps.sendAgentMessage).toHaveBeenCalled()
    expect(deps.setHandler).toHaveBeenCalledWith('c1', 'human', 'Quer agendar')
  })
  it('não envia se a conversa passou para a equipe durante a chamada da IA', async () => {
    const { deps } = make({
      loadConversation: vi.fn()
        .mockResolvedValueOnce(conv)
        .mockResolvedValueOnce({ ...conv, handler: 'human' as const }),
    })
    expect(await run(deps)).toBe('human')
    expect(deps.sendAgentMessage).not.toHaveBeenCalled()
    expect(deps.recordUsage).toHaveBeenCalledWith('k1', expect.objectContaining({ ok: true, input_tokens: 100, output_tokens: 20 }))
  })
  it('mensagem nova chegou durante a chamada da IA: não envia, superseded, uso ok true', async () => {
    const { deps } = make({ latestIncomingId: vi.fn().mockResolvedValueOnce('m1').mockResolvedValueOnce('m2') })
    expect(await run(deps)).toBe('superseded')
    expect(deps.latestIncomingId).toHaveBeenCalledTimes(2)
    expect(deps.sendAgentMessage).not.toHaveBeenCalled()
    expect(deps.markUnread).not.toHaveBeenCalled()
    expect(deps.recordUsage).toHaveBeenCalledWith('k1', expect.objectContaining({ ok: true, input_tokens: 100, output_tokens: 20 }))
  })
  it('erro da IA: nada enviado, não lida, uso ok false', async () => {
    const { deps } = make({}, new AiError('timeout'))
    expect(await run(deps)).toBe('error')
    expect(deps.sendAgentMessage).not.toHaveBeenCalled()
    expect(deps.markUnread).toHaveBeenCalledWith('c1')
    expect(deps.recordUsage).toHaveBeenCalledWith('k1', expect.objectContaining({ kind: 'agente', ok: false }))
  })
  it('saída inválida: erro sem envio', async () => {
    const { deps } = make({}, { acao: 'responder', resposta: '  ', nome: null, motivo: null })
    expect(await run(deps)).toBe('error')
    expect(deps.sendAgentMessage).not.toHaveBeenCalled()
    expect(deps.recordUsage).toHaveBeenCalledWith('k1', expect.objectContaining({ ok: false }))
  })
  it('envio false: erro, não lida, uso ok false, sem ação', async () => {
    const { deps } = make({ sendAgentMessage: vi.fn(async () => false) }, { acao: 'passar_recepcao', resposta: 'x', nome: null, motivo: 'm' })
    expect(await run(deps)).toBe('error')
    expect(deps.markUnread).toHaveBeenCalledWith('c1')
    expect(deps.setHandler).not.toHaveBeenCalled()
    expect(deps.recordUsage).toHaveBeenCalledWith('k1', expect.objectContaining({ ok: false }))
  })
  it('paciente cadastrado: contexto com primeiro nome e consultas', async () => {
    const { deps, organize } = make({
      loadConversation: vi.fn(async () => ({ ...conv, patient_id: 'p1' })),
      loadPatient: vi.fn(async () => ({ name: 'Ana Souza', optOut: false })),
      nextAppointments: vi.fn(async () => [{ start: '2026-11-10T13:00:00Z', professional: 'Dr. Lia' }]),
    })
    await run(deps)
    const arg = (organize.mock.calls[0] as unknown as [{ user: string }])[0]
    expect(arg.user).toContain('paciente Ana')
    expect(arg.user).toContain('Dr. Lia')
  })
})

describe('simulateAgent', () => {
  const clinic = {
    name: 'C', address: null, phone: null, insurances: [],
    config: { enabled: true, hours: {}, info: '' }, timezone: 'America/Sao_Paulo', whatsappConnected: true,
  }
  it('devolve a decisão e não envia nada', async () => {
    const { deps } = make()
    const r = await simulateAgent(deps, 'k1', 'oi', NOW)
    expect(r).toEqual({ acao: 'responder', resposta: 'Olá!' })
    expect(deps.sendAgentMessage).not.toHaveBeenCalled()
    expect(deps.setHandler).not.toHaveBeenCalled()
  })
  it('no_key sem IA', async () => {
    const r = await simulateAgent({ loadClinic: async () => clinic, getAi: async () => null, recordUsage: async () => {} }, 'k1', 'oi', NOW)
    expect(r).toBe('no_key')
  })
  it('saída inválida lança AiError bad_output', async () => {
    const { deps } = make({}, { acao: 'responder', resposta: '', nome: null, motivo: null })
    await expect(simulateAgent(deps, 'k1', 'oi', NOW)).rejects.toMatchObject({ kind: 'bad_output' })
  })
})
