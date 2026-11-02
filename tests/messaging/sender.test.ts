import { describe, it, expect } from 'vitest'
import { processQueue, type SendDeps } from '@/lib/messaging/sender'
import { PermanentSendError, TransientSendError, type WhatsAppProvider } from '@/lib/whatsapp/provider'
import type { MessagingConfig } from '@/lib/messaging/types'
import { FakeRepo } from './fakeRepo'

const cfg: MessagingConfig = { window_start: '08:00', window_end: '20:00', daily_limit: 300, timezone: 'America/Sao_Paulo' }
// 12:00 em São Paulo
const NOW = new Date('2026-11-02T15:00:00Z')

function makeProvider(behavior: (to: string, text: string) => Promise<void> | void = () => {}) {
  const sends: string[] = []
  const provider = {
    async sendText(_i: string, _t: string, to: string, text: string) {
      await behavior(to, text)
      sends.push(text)
      return { providerMessageId: 'pm-' + sends.length }
    },
  } as unknown as WhatsAppProvider
  return { provider, sends }
}

function setup(opts: { now?: Date; deadline?: Date; cfg?: Partial<MessagingConfig> } = {}) {
  const repo = new FakeRepo()
  const sleeps: number[] = []
  const now = opts.now ?? NOW
  repo.clock = () => now
  const deps: SendDeps = {
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    random: () => 0.5,
    deadline: opts.deadline ?? new Date(now.getTime() + 50_000),
  }
  const run = (provider: WhatsAppProvider, connected = true, d: SendDeps = deps) =>
    processQueue({ clinicId: 'c1', cfg: { ...cfg, ...opts.cfg }, instance: 'i', token: 't', connected, repo, provider, deps: d })
  return { repo, sleeps, deps, run }
}

describe('processQueue', () => {
  it('envia todos os itens vencidos, com esperas de 3 a 8 s só entre envios', async () => {
    const { repo, sleeps, run } = setup()
    repo.add({ id: 'a', body: 'a' })
    repo.add({ id: 'b', body: 'b' })
    repo.add({ id: 'c', body: 'c' })
    repo.add({ id: 'future', scheduled_for: new Date('2026-11-02T20:00:00Z') })
    const { provider, sends } = makeProvider()
    const res = await run(provider)
    expect(res).toEqual({ sent: 3, failed: 0, requeued: 0 })
    expect(sends).toEqual(['a', 'b', 'c'])
    expect(['a', 'b', 'c'].map((id) => repo.get(id).status)).toEqual(['sent', 'sent', 'sent'])
    expect(repo.get('a').provider_message_id).toBe('pm-1')
    expect(repo.get('future').status).toBe('queued')
    expect(sleeps).toHaveLength(2)
    for (const ms of sleeps) {
      expect(ms).toBeGreaterThanOrEqual(3000)
      expect(ms).toBeLessThanOrEqual(8000)
    }
  })

  it('ignora mensagens expiradas', async () => {
    const { repo, run } = setup()
    repo.add({ id: 'old', expires_at: new Date('2026-11-02T14:00:00Z') })
    const { provider, sends } = makeProvider()
    expect(await run(provider)).toEqual({ sent: 0, failed: 0, requeued: 0 })
    expect(sends).toHaveLength(0)
  })

  it('desconectado: não faz nada', async () => {
    const { repo, run } = setup()
    repo.add({ id: 'a' })
    const { provider, sends } = makeProvider()
    const res = await run(provider, false)
    expect(res.skippedReason).toBe('disconnected')
    expect(res.sent).toBe(0)
    expect(sends).toHaveLength(0)
    expect(repo.releaseStuckCalls).toHaveLength(0)
    expect(repo.get('a').status).toBe('queued')
  })

  it('fora da janela: não envia', async () => {
    const { repo, run } = setup({ now: new Date('2026-11-02T01:00:00Z') }) // 22h em SP
    repo.add({ id: 'a', scheduled_for: new Date('2026-11-01T12:00:00Z') })
    const { provider, sends } = makeProvider()
    const res = await run(provider)
    expect(res.skippedReason).toBe('outside_window')
    expect(sends).toHaveLength(0)
  })

  it('limite diário: com 1 já enviado hoje e limite 2, envia 1', async () => {
    const { repo, run } = setup({ cfg: { daily_limit: 2 } })
    repo.add({ id: 'done', status: 'sent', sent_at: new Date('2026-11-02T11:00:00Z') }) // 08:00 SP, hoje
    repo.add({ id: 'yesterday', status: 'sent', sent_at: new Date('2026-11-02T01:00:00Z') }) // ontem em SP
    repo.add({ id: 'a' })
    repo.add({ id: 'b' })
    const { provider, sends } = makeProvider()
    const res = await run(provider)
    expect(res).toEqual({ sent: 1, failed: 0, requeued: 0, skippedReason: 'daily_limit' })
    expect(sends).toHaveLength(1)
    expect(repo.get('b').status).toBe('queued')
  })

  it('limite diário já esgotado: não envia', async () => {
    const { repo, run } = setup({ cfg: { daily_limit: 1 } })
    repo.add({ id: 'done', status: 'sent', sent_at: new Date('2026-11-02T11:00:00Z') })
    repo.add({ id: 'a' })
    const { provider, sends } = makeProvider()
    expect((await run(provider)).skippedReason).toBe('daily_limit')
    expect(sends).toHaveLength(0)
  })

  it('erro temporário: reenfileira com attempts+1 e now+5min', async () => {
    const { repo, run } = setup()
    repo.add({ id: 'a', attempts: 0 })
    const { provider } = makeProvider(() => {
      throw new TransientSendError('timeout')
    })
    const res = await run(provider)
    expect(res).toEqual({ sent: 0, failed: 0, requeued: 1 })
    const r = repo.get('a')
    expect(r.status).toBe('queued')
    expect(r.attempts).toBe(1) // incrementado no lock
    expect(r.scheduled_for).toEqual(new Date(NOW.getTime() + 5 * 60_000))
    expect(r.error).toBe('timeout')
  })

  it('erro temporário na 3ª tentativa: falha definitiva', async () => {
    const { repo, run } = setup()
    repo.add({ id: 'a', attempts: 2 })
    const { provider } = makeProvider(() => {
      throw new TransientSendError('timeout')
    })
    expect(await run(provider)).toEqual({ sent: 0, failed: 1, requeued: 0 })
    expect(repo.get('a').status).toBe('failed')
  })

  it('erro desconhecido é tratado como temporário', async () => {
    const { repo, run } = setup()
    repo.add({ id: 'a' })
    const { provider } = makeProvider(() => {
      throw new Error('boom')
    })
    expect((await run(provider)).requeued).toBe(1)
  })

  it('erro permanente: falha sem nova tentativa', async () => {
    const { repo, run } = setup()
    repo.add({ id: 'a', attempts: 0 })
    const { provider } = makeProvider(() => {
      throw new PermanentSendError('número sem WhatsApp')
    })
    expect(await run(provider)).toEqual({ sent: 0, failed: 1, requeued: 0 })
    expect(repo.get('a').status).toBe('failed')
    expect(repo.get('a').error).toBe('número sem WhatsApp')
  })

  it('dois processQueue concorrentes enviam cada mensagem exatamente uma vez', async () => {
    const { repo, run } = setup()
    for (const id of ['a', 'b', 'c', 'd', 'e']) repo.add({ id, body: id })
    const counts = new Map<string, number>()
    const { provider } = makeProvider(async (_to, text) => {
      await Promise.resolve()
      counts.set(text, (counts.get(text) ?? 0) + 1)
    })
    const [r1, r2] = await Promise.all([run(provider), run(provider)])
    expect(r1.sent + r2.sent).toBe(5)
    expect([...counts.keys()].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
    for (const n of counts.values()) expect(n).toBe(1)
  })

  it('deadline atingido no meio: para e o restante continua queued', async () => {
    const { repo, deps, run } = setup()
    for (const id of ['a', 'b', 'c']) repo.add({ id, body: id })
    let t = NOW.getTime()
    const clocked: SendDeps = {
      ...deps,
      deadline: new Date(NOW.getTime() + 25_000),
      now: () => new Date(t),
      sleep: async (ms) => {
        t += ms + 3000
      },
    }
    const { provider, sends } = makeProvider()
    const res = await run(provider, true, clocked)
    // a em t=0, b em t=8,5 s (16,5 s de folga); após a espera seguinte (t=17 s) restam 8 s < 15 s
    expect(res.sent).toBe(2)
    expect(sends).toEqual(['a', 'b'])
    expect(repo.get('c').status).toBe('queued')
    expect(repo.rows.some((r) => r.status === 'sending')).toBe(false)
  })

  it('não inicia envio com menos de 15 s até o prazo (timeout do provedor)', async () => {
    const { repo, deps, run } = setup()
    repo.add({ id: 'a', body: 'a' })
    const { provider, sends } = makeProvider()
    const res = await run(provider, true, { ...deps, deadline: new Date(NOW.getTime() + 14_999) })
    expect(res.sent).toBe(0)
    expect(sends).toHaveLength(0)
    expect(repo.get('a').status).toBe('queued')
    const ok = await run(provider, true, { ...deps, deadline: new Date(NOW.getTime() + 15_000) })
    expect(ok.sent).toBe(1)
  })

  it('releaseStuck é chamado com now − 10 min', async () => {
    const { repo, run } = setup()
    const { provider } = makeProvider()
    await run(provider)
    expect(repo.releaseStuckCalls).toEqual([new Date(NOW.getTime() - 10 * 60_000)])
  })

  it('item preso em sending há mais de 10 min é marcado failed e não é reenviado', async () => {
    const { repo, run } = setup()
    repo.add({ id: 'stuck', status: 'sending', scheduled_for: new Date(NOW.getTime() - 11 * 60_000) })
    const { provider, sends } = makeProvider()
    expect((await run(provider)).sent).toBe(0)
    expect(sends).toHaveLength(0)
    expect(repo.get('stuck').status).toBe('failed')
    expect(repo.get('stuck').error).toContain('confira no WhatsApp')
  })

  it('markSent falha uma vez após envio ok: tenta de novo, envia uma só vez e fica sent', async () => {
    const { repo, run } = setup()
    repo.add({ id: 'a' })
    repo.markSentFailures = 1
    const { provider, sends } = makeProvider()
    const res = await run(provider)
    expect(sends).toHaveLength(1)
    expect(res.sent).toBe(1)
    expect(repo.get('a').status).toBe('sent')
  })

  it('markSent falha duas vezes: processQueue rejeita, sem reenfileirar', async () => {
    const { repo, run } = setup()
    repo.add({ id: 'a' })
    repo.markSentFailures = 2
    const { provider, sends } = makeProvider()
    await expect(run(provider)).rejects.toThrow('db down')
    expect(sends).toHaveLength(1)
    expect(repo.get('a').status).toBe('sending')
  })

  it('não dorme após lock perdido', async () => {
    const { repo, sleeps, run } = setup()
    repo.add({ id: 'a', body: 'a' })
    repo.add({ id: 'b', body: 'b' })
    const origLock = repo.lock.bind(repo)
    repo.lock = async (id) => (id === 'a' ? false : origLock(id))
    const { provider, sends } = makeProvider()
    await run(provider)
    expect(sends).toEqual(['b'])
    expect(sleeps).toHaveLength(0)
  })

  it('janela fecha no meio do ciclo: para com outside_window', async () => {
    const { repo, deps, run } = setup()
    repo.add({ id: 'a', body: 'a' })
    repo.add({ id: 'b', body: 'b' })
    let t = new Date('2026-11-02T22:59:58Z').getTime() // 19:59:58 em SP
    const clocked: SendDeps = {
      ...deps,
      deadline: new Date('2026-11-03T05:00:00Z'),
      now: () => new Date(t),
      sleep: async (ms) => {
        t += ms
      },
    }
    const { provider, sends } = makeProvider()
    const res = await run(provider, true, clocked)
    expect(sends).toEqual(['a'])
    expect(res.skippedReason).toBe('outside_window')
    expect(repo.get('b').status).toBe('queued')
  })
})
