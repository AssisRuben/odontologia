import { describe, it, expect, vi } from 'vitest'
import { runClinicsFairly } from '@/lib/messaging/cycle'

type C = { clinic_id: string }
const conns: C[] = [{ clinic_id: 'a' }, { clinic_id: 'b' }, { clinic_id: 'c' }]
const DEADLINE = new Date(50_000)

describe('runClinicsFairly', () => {
  it('prepara todas as clínicas antes de começar qualquer envio, e os envios rodam em paralelo', async () => {
    const log: string[] = []
    let releaseA!: () => void
    const aBlocked = new Promise<void>((r) => (releaseA = r))
    const res = runClinicsFairly(
      conns,
      {
        prepare: async (c) => {
          log.push(`prepare:${c.clinic_id}`)
          return { planned: 1, cancelled: 0 }
        },
        send: async (c) => {
          log.push(`send:${c.clinic_id}`)
          // a clínica "a" (fila grande) só termina depois que as outras já começaram
          if (c.clinic_id === 'a') await aBlocked
          log.push(`done:${c.clinic_id}`)
          return { sent: 1, failed: 0 }
        },
      },
      DEADLINE,
      () => 0,
    )
    await vi.waitFor(() => expect(log).toContain('done:c'))
    releaseA()
    const out = await res
    expect(log.slice(0, 3)).toEqual(['prepare:a', 'prepare:b', 'prepare:c'])
    expect(log.indexOf('send:b')).toBeLessThan(log.indexOf('done:a'))
    expect(log.indexOf('send:c')).toBeLessThan(log.indexOf('done:a'))
    expect(out).toEqual({
      a: { planned: 1, cancelled: 0, sent: 1, failed: 0 },
      b: { planned: 1, cancelled: 0, sent: 1, failed: 0 },
      c: { planned: 1, cancelled: 0, sent: 1, failed: 0 },
    })
  })

  it('erro ao preparar ou enviar uma clínica não afeta as outras', async () => {
    const send = vi.fn(async (c: C) => {
      if (c.clinic_id === 'c') throw new Error('provedor caiu')
      return { sent: 2, failed: 1, skippedReason: 'daily_limit' as const }
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await runClinicsFairly(
      conns,
      {
        prepare: async (c) => {
          if (c.clinic_id === 'a') throw new Error('db fora')
          return { planned: 3, cancelled: 1 }
        },
        send,
      },
      DEADLINE,
      () => 0,
    )
    errSpy.mockRestore()
    expect(send).toHaveBeenCalledTimes(2) // "a" falhou ao preparar: não envia
    expect(out).toEqual({
      a: { planned: 0, cancelled: 0, sent: 0, failed: 0, error: 'db fora' },
      b: { planned: 3, cancelled: 1, sent: 2, failed: 1, skippedReason: 'daily_limit' },
      c: { planned: 3, cancelled: 1, sent: 0, failed: 0, error: 'provedor caiu' },
    })
  })

  it('prazo esgotado durante a preparação: não prepara as restantes e não envia', async () => {
    let t = 0
    const send = vi.fn(async () => ({ sent: 1, failed: 0 }))
    const out = await runClinicsFairly(
      conns,
      {
        prepare: async () => {
          t += 30_000
          return { planned: 1, cancelled: 0 }
        },
        send,
      },
      DEADLINE,
      () => t,
    )
    expect(send).not.toHaveBeenCalled()
    expect(out).toEqual({
      a: { planned: 1, cancelled: 0, sent: 0, failed: 0, skippedReason: 'deadline' },
      b: { planned: 1, cancelled: 0, sent: 0, failed: 0, skippedReason: 'deadline' },
    })
  })
})
