import { describe, expect, it, vi } from 'vitest'
import { sendManual, type ManualDeps, type ManualPatient } from '@/lib/messaging/manual'

const cfg = { window_start: '08:00', window_end: '20:00', daily_limit: 10, timezone: 'America/Sao_Paulo' }
const patient: ManualPatient = { id: 'p1', whatsapp: '(11) 98765-4321', phone: null, whatsapp_opt_out: false }

function makeDeps(over: Partial<ManualDeps> = {}) {
  const base = {
    findPatient: vi.fn<ManualDeps['findPatient']>(async () => patient),
    getConnection: vi.fn<ManualDeps['getConnection']>(async () => ({ instance: 'i', token: 't', status: 'connected' })),
    getConfig: vi.fn<ManualDeps['getConfig']>(async () => cfg),
    countSentToday: vi.fn<ManualDeps['countSentToday']>(async () => 0),
    deliver: vi.fn<ManualDeps['deliver']>(async () => ({ ok: true, id: 'm1' })),
  }
  return { ...base, ...over } as typeof base
}

const input = (over: Record<string, unknown> = {}) => ({ clinicId: 'c1', patient_id: 'p1', body: ' Olá ', ...over })

describe('sendManual', () => {
  it('sucesso: 200 { id } e linha manual com telefone normalizado e texto aparado', async () => {
    const d = makeDeps()
    expect(await sendManual(input(), d)).toEqual({ status: 200, body: { id: 'm1' } })
    expect(d.findPatient).toHaveBeenCalledWith('c1', 'p1')
    expect(d.deliver).toHaveBeenCalledWith(
      { instance: 'i', token: 't', status: 'connected' },
      {
        clinic_id: 'c1', patient_id: 'p1', type: 'manual', direction: 'out',
        phone: '5511987654321', body: 'Olá', dedupe_key: null, budget_id: null, payment_id: null,
      },
    )
  })

  it('paymentId informado vai para payment_id da linha', async () => {
    const d = makeDeps()
    await sendManual(input({ paymentId: 'pay1' }), d)
    expect(d.deliver.mock.calls[0][1].payment_id).toBe('pay1')
  })

  it('usa o telefone quando não há WhatsApp', async () => {
    const d = makeDeps({ findPatient: vi.fn(async () => ({ ...patient, whatsapp: null, phone: '11 98765-4321' })) })
    await sendManual(input(), d)
    expect(d.deliver.mock.calls[0][1].phone).toBe('5511987654321')
  })

  it.each([[''], ['   '], [undefined], [42]])('texto vazio/inválido (%s) -> 422 Texto vazio', async (body) => {
    const d = makeDeps()
    expect(await sendManual(input({ body }), d)).toEqual({ status: 422, body: { error: 'Texto vazio' } })
    expect(d.findPatient).not.toHaveBeenCalled()
  })

  it('patient_id inválido -> 422', async () => {
    const r = await sendManual(input({ patient_id: 5 }), makeDeps())
    expect(r.status).toBe(422)
  })

  it('texto com 4096 passa; 4097 -> 422 Texto muito longo', async () => {
    expect((await sendManual(input({ body: 'a'.repeat(4096) }), makeDeps())).status).toBe(200)
    const d = makeDeps()
    expect(await sendManual(input({ body: 'a'.repeat(4097) }), d)).toEqual({
      status: 422, body: { error: 'Texto muito longo' },
    })
    expect(d.deliver).not.toHaveBeenCalled()
  })

  it('paciente de outra clínica/inexistente -> 404', async () => {
    const d = makeDeps({ findPatient: vi.fn(async () => null) })
    expect((await sendManual(input(), d)).status).toBe(404)
    expect(d.deliver).not.toHaveBeenCalled()
  })

  it('opt-out -> 422 antes de checar telefone e conexão', async () => {
    const d = makeDeps({ findPatient: vi.fn(async () => ({ ...patient, whatsapp: null, whatsapp_opt_out: true })) })
    expect(await sendManual(input(), d)).toEqual({
      status: 422, body: { error: 'Paciente optou por não receber WhatsApp' },
    })
    expect(d.getConnection).not.toHaveBeenCalled()
  })

  it('sem telefone válido -> 422', async () => {
    const d = makeDeps({ findPatient: vi.fn(async () => ({ ...patient, whatsapp: '123', phone: null })) })
    expect(await sendManual(input(), d)).toEqual({ status: 422, body: { error: 'Paciente sem WhatsApp válido' } })
  })

  it('sem conexão -> 409', async () => {
    const d = makeDeps({ getConnection: vi.fn(async () => null) })
    expect(await sendManual(input(), d)).toEqual({ status: 409, body: { error: 'WhatsApp da clínica desconectado' } })
  })

  it('conexão não conectada -> 409', async () => {
    const d = makeDeps({ getConnection: vi.fn(async () => ({ instance: 'i', token: 't', status: 'disconnected' })) })
    expect((await sendManual(input(), d)).status).toBe(409)
    expect(d.deliver).not.toHaveBeenCalled()
  })

  it('limite diário atingido -> 429; abaixo do limite envia', async () => {
    const d = makeDeps({ countSentToday: vi.fn(async () => 10) })
    expect(await sendManual(input(), d)).toEqual({
      status: 429, body: { error: 'Limite diário de mensagens atingido' },
    })
    expect(d.countSentToday).toHaveBeenCalledWith('c1', cfg)
    expect(d.deliver).not.toHaveBeenCalled()
    const ok = makeDeps({ countSentToday: vi.fn(async () => 9) })
    expect((await sendManual(input(), ok)).status).toBe(200)
  })

  it('falha do provedor -> 502 sem detalhes', async () => {
    const d = makeDeps({ deliver: vi.fn(async () => ({ ok: false as const, id: 'm1', error: 'evolution 500: segredo' })) })
    expect(await sendManual(input(), d)).toEqual({ status: 502, body: { error: 'Falha ao enviar pelo WhatsApp' } })
  })
})
