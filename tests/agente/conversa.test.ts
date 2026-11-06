import { describe, it, expect } from 'vitest'
import { shouldResume, truncateIncoming, contactLabel, HANDOFF_RESUME_MS } from '@/lib/agente/conversa'

const now = new Date('2026-11-06T20:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()

describe('shouldResume', () => {
  it('11h59 -> false', () => {
    expect(shouldResume({ handler: 'human', last_message_at: ago(HANDOFF_RESUME_MS - 60_000) }, now)).toBe(false)
  })
  it('12h -> true', () => {
    expect(shouldResume({ handler: 'human', last_message_at: ago(HANDOFF_RESUME_MS) }, now)).toBe(true)
  })
  it('agent -> false', () => {
    expect(shouldResume({ handler: 'agent', last_message_at: ago(HANDOFF_RESUME_MS * 2) }, now)).toBe(false)
  })
})

describe('truncateIncoming', () => {
  it('corta em 2000', () => {
    expect(truncateIncoming('a'.repeat(2500))).toHaveLength(2000)
  })
  it('faz trim', () => {
    expect(truncateIncoming('  oi  ')).toBe('oi')
  })
})

describe('contactLabel', () => {
  it('paciente', () => {
    expect(contactLabel({ patientName: 'Ana', contact_name: 'X', phone: '5511988887777' })).toBe('Ana')
  })
  it('nome do contato', () => {
    expect(contactLabel({ patientName: null, contact_name: 'Bia', phone: '5511988887777' })).toBe('Contato novo · Bia')
  })
  it('telefone formatado', () => {
    expect(contactLabel({ patientName: null, contact_name: null, phone: '5511988887777' })).toBe('Contato novo · (11) 98888-7777')
  })
  it('telefone cru', () => {
    expect(contactLabel({ patientName: null, contact_name: null, phone: '11988887777' })).toBe('Contato novo · (11) 98888-7777')
  })
})
