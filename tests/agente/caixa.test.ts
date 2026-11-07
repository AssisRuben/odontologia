import { describe, it, expect, vi } from 'vitest'
import { parseFiltro, parseResposta, responderConversa, cadastrarPaciente, parseNome } from '@/lib/agente/caixa'

const CONV = { id: 'c1', phone: '5511999990000', patient_id: null as string | null, handler: 'agent' as 'agent' | 'human', contact_name: 'Ana' }

function respDeps(over: Record<string, unknown> = {}) {
  return {
    loadConversation: vi.fn(async (clinicId: string, id: string) => (clinicId === 'k1' && id === 'c1' ? { ...CONV } : null)),
    getConnection: vi.fn(async () => ({ instance: 'i', token: 't', status: 'connected' })),
    send: vi.fn(async () => ({ ok: true as const })),
    markAnswered: vi.fn(async () => {}),
    ...over,
  }
}

describe('parseFiltro', () => {
  it('padrão aguardando e valores válidos', () => {
    expect(parseFiltro(null)).toBe('aguardando')
    expect(parseFiltro('xx')).toBe('aguardando')
    expect(parseFiltro('agente')).toBe('agente')
    expect(parseFiltro('todas')).toBe('todas')
  })
})

describe('parseResposta', () => {
  it('trim e limites', () => {
    expect(parseResposta({ texto: '  oi  ' })).toEqual({ ok: true, texto: 'oi' })
    const bad = { ok: false, error: 'Mensagem vazia ou longa demais' }
    expect(parseResposta({ texto: '   ' })).toEqual(bad)
    expect(parseResposta({ texto: 'a'.repeat(1001) })).toEqual(bad)
    expect(parseResposta(null)).toEqual(bad)
    expect(parseResposta({ texto: 'a'.repeat(1000) }).ok).toBe(true)
  })
})

describe('parseNome', () => {
  it('2 a 120 caracteres', () => {
    expect(parseNome({ name: ' Ana ' })).toEqual({ ok: true, name: 'Ana' })
    expect(parseNome({ name: 'A' })).toEqual({ ok: false, error: 'Nome inválido' })
    expect(parseNome({ name: 'a'.repeat(121) }).ok).toBe(false)
    expect(parseNome({})).toEqual({ ok: false, error: 'Nome inválido' })
  })
})

describe('responderConversa', () => {
  it('responder sem conexão → 409 e nenhum envio', async () => {
    const deps = respDeps({ getConnection: vi.fn(async () => ({ instance: 'i', token: 't', status: 'disconnected' })) })
    const r = await responderConversa(deps, 'k1', 'c1', 'oi')
    expect(r).toEqual({ status: 409, body: { error: 'WhatsApp desconectado' } })
    expect(deps.send).not.toHaveBeenCalled()
    expect(deps.markAnswered).not.toHaveBeenCalled()
  })
  it('sem registro de conexão → 409', async () => {
    const deps = respDeps({ getConnection: vi.fn(async () => null) })
    expect((await responderConversa(deps, 'k1', 'c1', 'oi')).status).toBe(409)
  })
  it('conversa de outra clínica → 404', async () => {
    const deps = respDeps()
    const r = await responderConversa(deps, 'outra', 'c1', 'oi')
    expect(r).toEqual({ status: 404, body: { error: 'Conversa não encontrada' } })
    expect(deps.send).not.toHaveBeenCalled()
  })
  it('envio falho → 502 e handler não muda', async () => {
    const deps = respDeps({ send: vi.fn(async () => ({ ok: false as const })) })
    const r = await responderConversa(deps, 'k1', 'c1', 'oi')
    expect(r).toEqual({ status: 502, body: { error: 'Não foi possível enviar. Tente de novo.' } })
    expect(deps.markAnswered).not.toHaveBeenCalled()
  })
  it('sucesso envia tipo human e assume a conversa que estava com o agente', async () => {
    const deps = respDeps()
    const r = await responderConversa(deps, 'k1', 'c1', 'oi')
    expect(r.status).toBe(200)
    expect(deps.send).toHaveBeenCalledWith(
      { instance: 'i', token: 't' },
      expect.objectContaining({ clinic_id: 'k1', conversation_id: 'c1', type: 'human', direction: 'out', phone: CONV.phone, body: 'oi' }),
    )
    expect(deps.markAnswered).toHaveBeenCalledWith('c1', 'Assumida pela equipe')
  })
  it('falha ao marcar como respondida depois do envio ainda devolve sucesso', async () => {
    const deps = respDeps({ markAnswered: vi.fn(async () => { throw new Error('db') }) })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await responderConversa(deps, 'k1', 'c1', 'oi')).toEqual({ status: 200, body: { ok: true } })
    expect(err).toHaveBeenCalled()
    expect(JSON.stringify(err.mock.calls)).not.toContain('oi')
    err.mockRestore()
  })
  it('conversa já com a equipe mantém o motivo', async () => {
    const deps = respDeps({ loadConversation: vi.fn(async () => ({ ...CONV, handler: 'human' })) })
    await responderConversa(deps, 'k1', 'c1', 'oi')
    expect(deps.markAnswered).toHaveBeenCalledWith('c1', null)
  })
})

describe('cadastrarPaciente', () => {
  function pDeps(over: Record<string, unknown> = {}) {
    return {
      loadConversation: vi.fn(async (clinicId: string, id: string) => (clinicId === 'k1' && id === 'c1' ? { ...CONV } : null)),
      createPatient: vi.fn(async () => 'p1'),
      linkPatient: vi.fn(async () => {}),
      ...over,
    }
  }
  it('outra clínica → 404', async () => {
    const deps = pDeps()
    expect((await cadastrarPaciente(deps, 'outra', 'c1', 'Ana')).status).toBe(404)
    expect(deps.createPatient).not.toHaveBeenCalled()
  })
  it('já ligada → 409', async () => {
    const deps = pDeps({ loadConversation: vi.fn(async () => ({ ...CONV, patient_id: 'p0' })) })
    const r = await cadastrarPaciente(deps, 'k1', 'c1', 'Ana')
    expect(r).toEqual({ status: 409, body: { error: 'Conversa já ligada a um paciente' } })
    expect(deps.createPatient).not.toHaveBeenCalled()
  })
  it('cria e liga', async () => {
    const deps = pDeps()
    const r = await cadastrarPaciente(deps, 'k1', 'c1', 'Ana')
    expect(r).toEqual({ status: 200, body: { patientId: 'p1' } })
    expect(deps.createPatient).toHaveBeenCalledWith('k1', 'Ana', CONV.phone)
    expect(deps.linkPatient).toHaveBeenCalledWith('c1', 'p1')
  })
})
