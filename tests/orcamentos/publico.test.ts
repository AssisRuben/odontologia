import { describe, it, expect, vi } from 'vitest'
import { newToken, type LinkRecord } from '@/lib/orcamentos/links'
import { publicView, recordView, signPublic, declinePublic, clientIp, receiptAvailable, type PublicDeps } from '@/lib/orcamentos/publico'
import type { ApprovalDeps } from '@/lib/orcamentos/aprovacao'

const NOW = new Date('2026-11-05T15:00:00Z')
const DAY = 24 * 3600 * 1000
const tok = newToken()
const LOCK_MSG = 'Muitas tentativas. Tente de novo em 1 hora ou fale com a clínica.'

const rec = (o: Partial<LinkRecord> = {}): LinkRecord => ({
  id: 'l1', budget_id: 'b1', clinic_id: 'c1', revoked_at: null, locked_until: null,
  budget_status: 'sent', valid_until: null, signed_at: null, signature_link_id: null, ...o,
})

function mk(r: LinkRecord | null = rec(), over: Partial<PublicDeps> = {}) {
  const d = {
    findByToken: vi.fn(async () => r),
    registerFailed: vi.fn(async () => false),
    loadOpen: vi.fn(async () => ({
      clinic: { name: 'Clínica X', logoUrl: null }, professional: 'Dra. Ana', number: 'ABCD1234',
      createdAt: '2026-11-01T10:00:00Z', validUntil: '2026-12-01',
      items: [{ id: 'i1', procedure: 'Limpeza', tooth: null, quantity: 1, unitPrice: 100 }],
    })),
    patientCpfs: vi.fn(async () => ({ cpf: '52998224725', payerCpf: null })),
    bumpView: vi.fn(async () => 0),
    markViewed: vi.fn(async () => undefined),
    addViewedEvent: vi.fn(async () => undefined),
    loadForApproval: vi.fn(async () => ({
      budget: { id: 'b1', created_at: '2026-11-01T10:00:00Z', valid_until: null },
      clinicName: 'X', patientName: 'Maria', professionalName: null,
      items: [{ id: 'i1', procedure: 'Limpeza', tooth: null, quantity: 1, unit_price: 100 }],
    })),
    actorName: vi.fn(async () => null),
    rpcApprove: vi.fn(async () => 'ok'),
    rpcReject: vi.fn(async () => 'ok'),
    listSent: vi.fn(async () => []),
    ...over,
  }
  return d as unknown as PublicDeps & ApprovalDeps & Record<string, ReturnType<typeof vi.fn>>
}

const body = { itemIds: ['i1'], name: 'Maria da Silva', cpf: '529.982.247-25', agreed: true }
const ctx = { ip: '1.2.3.4', userAgent: 'UA', now: NOW }

describe('publicView', () => {
  it('inexistente, desativado, rejeitado, vencido -> unavailable', async () => {
    expect(await publicView(tok, NOW, mk(null))).toEqual({ kind: 'unavailable' })
    expect(await publicView(tok, NOW, mk(rec({ revoked_at: '2026-11-02T00:00:00Z' })))).toEqual({ kind: 'unavailable' })
    expect(await publicView(tok, NOW, mk(rec({ budget_status: 'rejected' })))).toEqual({ kind: 'unavailable' })
    expect(await publicView(tok, NOW, mk(rec({ budget_status: 'expired' })))).toEqual({ kind: 'unavailable' })
    expect(await publicView(tok, NOW, mk(rec({ valid_until: '2026-11-01' })))).toEqual({ kind: 'unavailable' })
  })
  it('aprovado há 29 dias baixa; há 31 não', async () => {
    const at = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString()
    const a = await publicView(tok, NOW, mk(rec({ budget_status: 'approved', revoked_at: 'x', signed_at: at(29), signature_link_id: 'l1' })))
    expect(a).toMatchObject({ kind: 'approved', canDownload: true })
    const b = await publicView(tok, NOW, mk(rec({ budget_status: 'approved', signed_at: at(31), signature_link_id: 'l1' })))
    expect(b).toMatchObject({ kind: 'approved', canDownload: false })
    const c = await publicView(tok, NOW, mk(rec({ budget_status: 'approved', signed_at: at(30), signature_link_id: 'l1' })))
    expect(c).toMatchObject({ canDownload: true })
  })
  it('link revogado antes da assinatura (outro link assinou) -> unavailable', async () => {
    const r = rec({ budget_status: 'approved', revoked_at: 'x', signed_at: new Date(NOW.getTime() - DAY).toISOString(), signature_link_id: 'outro' })
    expect(await publicView(tok, NOW, mk(r))).toEqual({ kind: 'unavailable' })
  })
  it('aprovação pela recepção (sem link) -> unavailable', async () => {
    const r = rec({ budget_status: 'approved', signed_at: new Date(NOW.getTime() - DAY).toISOString(), signature_link_id: null })
    expect(await publicView(tok, NOW, mk(r))).toEqual({ kind: 'unavailable' })
  })
  it('open não vaza CPF, telefone nem e-mail', async () => {
    const v = await publicView(tok, NOW, mk())
    expect(v.kind).toBe('open')
    const s = JSON.stringify(v)
    expect(s).not.toMatch(/cpf|phone|email|52998224725/i)
  })
  it('page GET does not record view', async () => {
    const d = mk()
    await publicView(tok, NOW, d)
    expect(d.bumpView).not.toHaveBeenCalled()
    expect(d.markViewed).not.toHaveBeenCalled()
    expect(d.addViewedEvent).not.toHaveBeenCalled()
  })
})

describe('receiptAvailable', () => {
  const v = (o = {}) => ({ status: 'approved', linkId: 'l1', signatureLinkId: 'l1', signedAt: new Date(NOW.getTime() - DAY), ...o })
  it('só no link que assinou, aprovado e dentro de 30 dias', () => {
    expect(receiptAvailable(v(), NOW)).toBe(true)
    expect(receiptAvailable(v({ signatureLinkId: 'outro' }), NOW)).toBe(false)
    expect(receiptAvailable(v({ signatureLinkId: null }), NOW)).toBe(false)
    expect(receiptAvailable(v({ status: 'sent' }), NOW)).toBe(false)
    expect(receiptAvailable(v({ signedAt: new Date(NOW.getTime() - 31 * DAY) }), NOW)).toBe(false)
  })
})

describe('recordView', () => {
  it('primeira vez grava evento', async () => {
    const d = mk()
    expect(await recordView(tok, NOW, d)).toBe(true)
    expect(d.bumpView).toHaveBeenCalledWith('l1', 'c1')
    expect(d.markViewed).toHaveBeenCalledWith('b1', 'c1', NOW)
    expect(d.addViewedEvent).toHaveBeenCalledWith('b1', 'c1')
  })
  it('segunda vez não grava evento', async () => {
    const d = mk(rec(), { bumpView: vi.fn(async () => 3) })
    await recordView(tok, NOW, d)
    expect(d.addViewedEvent).not.toHaveBeenCalled()
  })
  it('link inativo não registra', async () => {
    const d = mk(rec({ budget_status: 'rejected' }))
    expect(await recordView(tok, NOW, d)).toBe(false)
    expect(d.bumpView).not.toHaveBeenCalled()
  })
})

describe('signPublic', () => {
  it('link bloqueado -> 429', async () => {
    const d = mk(rec({ locked_until: new Date(NOW.getTime() + 1000).toISOString() }))
    const r = await signPublic(tok, body, ctx, d)
    expect(r).toEqual({ status: 429, body: { error: LOCK_MSG } })
    expect(d.rpcApprove).not.toHaveBeenCalled()
  })
  it('agreed falso -> 422', async () => {
    const r = await signPublic(tok, { ...body, agreed: false }, ctx, mk())
    expect(r.status).toBe(422)
    expect(r.body).toEqual({ error: 'Confirme que leu e concorda com os itens selecionados' })
  })
  it('CPF errado incrementa tentativa; na 5ª bloqueia com 429', async () => {
    const d = mk()
    const r = await signPublic(tok, { ...body, cpf: '111.444.777-35' }, ctx, d)
    expect(r.status).toBe(422)
    expect(d.registerFailed).toHaveBeenCalledWith('l1', 'c1')
    const d2 = mk(rec(), { registerFailed: vi.fn(async () => true) })
    const r2 = await signPublic(tok, { ...body, cpf: '111.444.777-35' }, ctx, d2)
    expect(r2).toEqual({ status: 429, body: { error: LOCK_MSG } })
  })
  it('CPF inválido não conta tentativa', async () => {
    const d = mk()
    const r = await signPublic(tok, { ...body, cpf: '123' }, ctx, d)
    expect(r).toEqual({ status: 422, body: { error: 'CPF inválido' } })
    expect(d.registerFailed).not.toHaveBeenCalled()
  })
  it('nome curto -> 422', async () => {
    const r = await signPublic(tok, { ...body, name: ' ab ' }, ctx, mk())
    expect(r).toEqual({ status: 422, body: { error: 'Informe o nome completo' } })
  })
  it('já respondido -> 409; inexistente -> 404', async () => {
    expect((await signPublic(tok, body, ctx, mk(rec({ budget_status: 'approved' })))).status).toBe(409)
    const r = await signPublic(tok, body, ctx, mk(null))
    expect(r).toEqual({ status: 404, body: { error: 'Este link não está mais disponível. Fale com a clínica.' } })
  })
  it('sucesso aprova com signer e ip/UA cortados em 300', async () => {
    const d = mk()
    const r = await signPublic(tok, body, { ...ctx, ip: 'x'.repeat(400), userAgent: 'u'.repeat(400) }, d)
    expect(r).toEqual({ status: 200, body: { ok: true } })
    const sig = vi.mocked(d.rpcApprove).mock.calls[0][4]
    expect(sig.signer_cpf).toBe('52998224725')
    expect(sig.signer_name).toBe('Maria da Silva')
    expect(sig.ip).toHaveLength(300)
    expect(sig.user_agent).toHaveLength(300)
  })
})

describe('declinePublic', () => {
  it('rejeita via link', async () => {
    const d = mk()
    const r = await declinePublic(tok, NOW, { reason: 'preco', note: ' caro ' }, d)
    expect(r.status).toBe(200)
    expect(d.rpcReject).toHaveBeenCalledWith('b1', 'l1', 'preco', 'caro', null, 'rejected')
  })
  it('motivo inválido vira null', async () => {
    const d = mk()
    await declinePublic(tok, NOW, { reason: 'xx' }, d)
    expect(vi.mocked(d.rpcReject).mock.calls[0][2]).toBeNull()
  })
})

describe('clientIp', () => {
  it('primeiro valor de x-forwarded-for, aparado e cortado em 300', () => {
    expect(clientIp(' 9.9.9.9 , 8.8.8.8')).toBe('9.9.9.9')
    expect(clientIp('y'.repeat(500))).toHaveLength(300)
    expect(clientIp(null)).toBeNull()
  })
})
