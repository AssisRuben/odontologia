import { describe, it, expect } from 'vitest'
import { contactOutcome } from '@/lib/orcamentos/contato'

const today = '2026-11-05'

describe('contactOutcome', () => {
  it('nao_atendeu agenda para amanhã', () => {
    expect(contactOutcome('nao_atendeu', null, today)).toEqual({ followup_at: '2026-11-06', next: 'none' })
  })
  it('pensar sem data usa hoje + 3', () => {
    expect(contactOutcome('pensar', null, today)).toEqual({ followup_at: '2026-11-08', next: 'none' })
  })
  it('pensar com data usa a data', () => {
    expect(contactOutcome('pensar', '2026-11-20', today)).toEqual({ followup_at: '2026-11-20', next: 'none' })
  })
  it('virada de mês e de ano', () => {
    expect(contactOutcome('nao_atendeu', null, '2026-12-31').followup_at).toBe('2027-01-01')
  })
  it('aprovou e perdido não agendam retorno', () => {
    expect(contactOutcome('aprovou', '2026-11-20', today)).toEqual({ followup_at: null, next: 'approve' })
    expect(contactOutcome('perdido', null, today)).toEqual({ followup_at: null, next: 'lose' })
  })
})
