import { describe, it, expect, vi } from 'vitest'
import { newToken, linkUrl, resolveLink, registerFailedAttempt, isLocked, type LinkDeps, type LinkRecord } from '@/lib/orcamentos/links'

const rec = (o: Partial<LinkRecord> = {}): LinkRecord => ({
  id: 'l1', budget_id: 'b1', clinic_id: 'c1', revoked_at: null, locked_until: null,
  budget_status: 'sent', valid_until: null, signed_at: null, signature_link_id: null, ...o,
})

function deps(over: Partial<LinkDeps> = {}) {
  return {
    findByToken: vi.fn(async () => rec()),
    registerFailed: vi.fn(async () => false),
    ...over,
  } as LinkDeps & Record<string, ReturnType<typeof vi.fn>>
}

describe('token', () => {
  it('tem 43 caracteres url-safe e é único', () => {
    const a = newToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(newToken()).not.toBe(a)
  })
  it('linkUrl usa APP_URL', () => {
    delete process.env.PUBLIC_APP_URL
    process.env.APP_URL = 'https://x.app'
    expect(linkUrl('abc')).toBe('https://x.app/orcamento/abc')
  })
  it('linkUrl prefere PUBLIC_APP_URL e tira a barra final', () => {
    process.env.APP_URL = 'http://host.docker.internal:3001'
    process.env.PUBLIC_APP_URL = 'https://tunel.example/'
    expect(linkUrl('abc')).toBe('https://tunel.example/orcamento/abc')
    delete process.env.PUBLIC_APP_URL
  })
})

describe('resolveLink', () => {
  it('formato inválido -> null sem consultar', async () => {
    const d = deps()
    expect(await resolveLink('curto', d)).toBeNull()
    expect(await resolveLink('a'.repeat(42) + '!', d)).toBeNull()
    expect(d.findByToken).not.toHaveBeenCalled()
  })
  it('inexistente -> null', async () => {
    expect(await resolveLink(newToken(), deps({ findByToken: vi.fn(async () => null) }))).toBeNull()
  })
  it('link ativo de orçamento enviado', async () => {
    const v = await resolveLink(newToken(), deps())
    expect(v).toEqual({ linkId: 'l1', budgetId: 'b1', clinicId: 'c1', status: 'sent', active: true, lockedUntil: null, signedAt: null, signatureLinkId: null, validUntil: null })
  })
  it('validade: ontem inativo, hoje ativo (fuso São Paulo)', async () => {
    const now = new Date('2026-11-06T01:00:00Z') // 05/11 22:00 em São Paulo
    const t = newToken()
    const mk = (v: string) => deps({ findByToken: vi.fn(async () => rec({ valid_until: v })) })
    expect((await resolveLink(t, mk('2026-11-04'), now))!.active).toBe(false)
    expect((await resolveLink(t, mk('2026-11-05'), now))!.active).toBe(true)
  })
  it('revogado ou orçamento decidido -> inativo', async () => {
    const t = newToken()
    expect((await resolveLink(t, deps({ findByToken: vi.fn(async () => rec({ revoked_at: '2026-01-01T00:00:00Z' })) })))!.active).toBe(false)
    expect((await resolveLink(t, deps({ findByToken: vi.fn(async () => rec({ budget_status: 'approved', signed_at: '2026-01-02T00:00:00Z' })) })))!.active).toBe(false)
  })
  it('converte datas', async () => {
    const v = await resolveLink(newToken(), deps({ findByToken: vi.fn(async () => rec({ locked_until: '2026-01-01T10:00:00Z', signed_at: '2026-01-01T09:00:00Z' })) }))
    expect(v!.lockedUntil).toEqual(new Date('2026-01-01T10:00:00Z'))
    expect(v!.signedAt).toEqual(new Date('2026-01-01T09:00:00Z'))
  })
})

describe('tentativas', () => {
  const now = new Date('2026-11-05T12:00:00Z')
  it('delega ao RPC atômico com a clínica', async () => {
    const d = deps()
    expect(await registerFailedAttempt('l1', 'c1', now, d)).toEqual({ locked: false })
    expect(d.registerFailed).toHaveBeenCalledWith('l1', 'c1')
  })
  it('repassa o bloqueio', async () => {
    const d = deps({ registerFailed: vi.fn(async () => true) })
    expect(await registerFailedAttempt('l1', 'c1', now, d)).toEqual({ locked: true })
  })
  it('isLocked', () => {
    const view = (lockedUntil: Date | null) => ({ linkId: 'l1', budgetId: 'b', clinicId: 'c', status: 'sent' as const, active: true, lockedUntil, signedAt: null, signatureLinkId: null, validUntil: null })
    expect(isLocked(view(null), now)).toBe(false)
    expect(isLocked(view(new Date('2026-11-05T12:30:00Z')), now)).toBe(true)
    expect(isLocked(view(new Date('2026-11-05T11:59:00Z')), now)).toBe(false)
  })
})
