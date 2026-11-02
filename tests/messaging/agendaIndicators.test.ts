import { describe, expect, it } from 'vitest'
import {
  computeCancelNotices,
  computeIndicators,
  formatNoticeTime,
  type MessageRow,
} from '@/components/agenda/useWhatsAppStatus'
import type { Appointment } from '@/types'

const apt = (id: string, status: string) => ({ id, status }) as unknown as Appointment
const conf = (id: string, status = 'sent'): MessageRow => ({ appointment_id: id, type: 'confirmation', status, created_at: '2026-11-02T10:00:00Z' })
const reply = (id: string, reply_action: 'confirmed' | 'cancelled' | null, at = '2026-11-02T11:00:00Z'): MessageRow => ({ appointment_id: id, type: 'incoming', status: 'received', reply_action, created_at: at })
const OK = 'confirmed' as const
const NO = 'cancelled' as const

describe('computeIndicators', () => {
  it('confirmada pelo WhatsApp exige resposta confirmando E consulta confirmed', () => {
    const m = computeIndicators([conf('a'), reply('a', OK)], [apt('a', 'confirmed')])
    expect(m.get('a')).toBe('confirmed')
  })
  it('resposta confirmando mas consulta não confirmada: cai para confirmação enviada', () => {
    const m = computeIndicators([conf('a'), reply('a', OK)], [apt('a', 'scheduled')])
    expect(m.get('a')).toBe('sent')
  })
  it('confirmação enviada; ignora failed e consultas fora da lista', () => {
    const m = computeIndicators([conf('a'), conf('b', 'failed'), conf('c')], [apt('a', 'scheduled'), apt('b', 'scheduled')])
    expect(m.get('a')).toBe('sent')
    expect(m.has('b')).toBe(false)
    expect(m.has('c')).toBe(false)
  })
  it('incoming sem reply_action não conta', () => {
    const m = computeIndicators([reply('a', null)], [apt('a', 'confirmed')])
    expect(m.has('a')).toBe(false)
  })
  it('confirmada vence mesmo se a linha de confirmação vier depois', () => {
    const m = computeIndicators([reply('a', OK), conf('a')], [apt('a', 'confirmed')])
    expect(m.get('a')).toBe('confirmed')
  })
})

describe('computeCancelNotices', () => {
  const now = new Date('2026-11-02T12:00:00Z')
  it('inclui desmarcadas nas últimas 24 h ainda canceladas', () => {
    const out = computeCancelNotices([reply('a', NO)], [apt('a', 'cancelled')], now)
    expect(out.map((n) => n.appointment.id)).toEqual(['a'])
  })
  it('exclui >24 h, status não cancelado, confirmações e duplicatas', () => {
    const rows = [
      reply('old', NO, '2026-11-01T11:59:00Z'),
      reply('re', NO),
      reply('ok', OK),
      reply('a', NO),
      reply('a', NO, '2026-11-02T11:30:00Z'),
    ]
    const out = computeCancelNotices(
      rows,
      [apt('old', 'cancelled'), apt('re', 'scheduled'), apt('ok', 'confirmed'), apt('a', 'cancelled')],
      now,
    )
    expect(out.map((n) => n.appointment.id)).toEqual(['a'])
  })
})

describe('formatNoticeTime', () => {
  it('dd/MM HH:mm em America/Sao_Paulo', () => {
    expect(formatNoticeTime('2026-11-03T12:30:00Z')).toBe('03/11 09:30')
  })
})
