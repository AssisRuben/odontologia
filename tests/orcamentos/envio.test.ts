import { describe, it, expect, vi, type MockedObject } from 'vitest'
import { sendBudget, type SendDeps } from '@/lib/orcamentos/envio'

process.env.APP_URL = 'https://x.app'

const budget = { id: 'b1', patient_id: 'p1', status: 'draft' as const, total: 300, itemCount: 2 }

function deps(over: Partial<SendDeps> = {}) {
  return {
    loadBudget: vi.fn(async () => budget),
    getValidityDays: vi.fn(async () => 30),
    getActiveLink: vi.fn(async () => null),
    rpcSend: vi.fn(async () => 'ok' as const),
    insertResent: vi.fn(async () => undefined),
    loadMessageContext: vi.fn(async () => ({
      patient: { id: 'p1', name: 'Maria Silva', phone: null, whatsapp: null, birthdate: null, whatsapp_opt_out: false },
      clinicName: 'Clínica', tz: 'America/Sao_Paulo', template: null as string | null, total: 300, valid_until: '2026-12-05' as string | null,
    })),
    sendMessage: vi.fn(async () => ({ status: 200, body: { id: 'm1' } as { id: string } | { error: string } })),
    ...over,
  } as unknown as MockedObject<SendDeps>
}

const input = { budgetId: 'b1', clinicId: 'c1', actorId: 'u1', resend: false }

describe('sendBudget', () => {
  it('envio novo: send_budget com token e validade, depois WhatsApp budget', async () => {
    const d = deps()
    const r = await sendBudget(input, d)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ sent: true })
    const link = (r.body as { link: string }).link
    expect(link).toMatch(/^https:\/\/x\.app\/orcamento\/[A-Za-z0-9_-]{43}$/)
    const [bid, token, days, actor] = d.rpcSend.mock.calls[0]
    expect([bid, days, actor]).toEqual(['b1', 30, 'u1'])
    expect(link.endsWith(token)).toBe(true)
    const msg = d.sendMessage.mock.calls[0][0]
    expect(msg).toMatchObject({ clinicId: 'c1', patient_id: 'p1', kind: 'budget', budgetId: 'b1' })
    expect(msg.body).toContain('Olá, Maria!')
    expect(msg.body).toContain('R$')
    expect(msg.body).toContain(link)
  })
  it('usa modelo da clínica quando existe', async () => {
    const d = deps()
    d.loadMessageContext.mockResolvedValue({
      patient: { id: 'p1', name: 'Maria', phone: null, whatsapp: null, birthdate: null, whatsapp_opt_out: false },
      clinicName: 'C', tz: 'America/Sao_Paulo', template: 'Oi {paciente} {link}', total: 1, valid_until: null,
    })
    await sendBudget(input, d)
    expect(d.sendMessage.mock.calls[0][0].body).toMatch(/^Oi Maria https:\/\/x\.app\/orcamento\//)
  })
  it('total zero -> 422 com a mensagem da spec', async () => {
    const d = deps({ loadBudget: vi.fn(async () => ({ ...budget, total: 0 })) })
    expect(await sendBudget(input, d)).toEqual({ status: 422, body: { error: 'Adicione ao menos um item com valor antes de enviar' } })
    expect(d.rpcSend).not.toHaveBeenCalled()
  })
  it('inexistente -> 404', async () => {
    const d = deps({ loadBudget: vi.fn(async () => null) })
    expect((await sendBudget(input, d)).status).toBe(404)
  })
  it('not_sendable do banco -> 422', async () => {
    const d = deps({ rpcSend: vi.fn(async () => 'not_sendable' as const) })
    expect((await sendBudget(input, d)).status).toBe(422)
  })
  it('WhatsApp desconectado -> 200, sent false, aviso e link', async () => {
    const d = deps({ sendMessage: vi.fn(async () => ({ status: 409, body: { error: 'WhatsApp da clínica desconectado' } })) })
    const r = await sendBudget(input, d)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({
      sent: false, warning: 'WhatsApp desconectado. O link foi criado: copie e envie por outro meio.',
    })
    expect((r.body as { link: string }).link).toContain('/orcamento/')
  })
  it('sem telefone -> aviso', async () => {
    const d = deps({ sendMessage: vi.fn(async () => ({ status: 422, body: { error: 'Paciente sem WhatsApp válido' } })) })
    expect((await sendBudget(input, d)).body).toMatchObject({ sent: false, warning: 'Paciente sem telefone. Copie o link e envie por outro meio.' })
  })
  it('outro erro repassa o texto', async () => {
    const d = deps({ sendMessage: vi.fn(async () => ({ status: 429, body: { error: 'Limite diário de mensagens atingido' } })) })
    expect((await sendBudget(input, d)).body).toMatchObject({ sent: false, warning: 'Limite diário de mensagens atingido' })
  })
  it('reenvio reaproveita o link, sem send_budget, com evento resent', async () => {
    const d = deps({
      loadBudget: vi.fn(async () => ({ ...budget, status: 'sent' as const })),
      getActiveLink: vi.fn(async () => ({ id: 'l1', token: 'T'.repeat(43) })),
    })
    const r = await sendBudget({ ...input, resend: true }, d)
    expect(d.rpcSend).not.toHaveBeenCalled()
    expect(d.insertResent).toHaveBeenCalledWith('b1', 'c1', 'u1')
    expect((r.body as { link: string }).link).toBe(`https://x.app/orcamento/${'T'.repeat(43)}`)
    expect(d.sendMessage).toHaveBeenCalledTimes(1)
  })
  it('reenvio sem link ativo age como envio novo', async () => {
    const d = deps({ loadBudget: vi.fn(async () => ({ ...budget, status: 'sent' as const })) })
    await sendBudget({ ...input, resend: true }, d)
    expect(d.rpcSend).toHaveBeenCalledTimes(1)
    expect(d.insertResent).not.toHaveBeenCalled()
  })
})
