import { describe, it, expect } from 'vitest'
import { canSend, canReopen, canDecideByReception, lostReasonLabel, STAGE_LABEL, LOST_REASONS } from '@/lib/orcamentos/etapas'

describe('etapas', () => {
  it('canSend recusa total 0 e sem itens', () => {
    const err = { ok: false, error: 'Adicione ao menos um item com valor antes de enviar' }
    expect(canSend({ status: 'draft', total: 0, itemCount: 2 })).toEqual(err)
    expect(canSend({ status: 'draft', total: 100, itemCount: 0 })).toEqual(err)
  })
  it('canSend recusa approved e aceita draft e sent', () => {
    expect(canSend({ status: 'approved', total: 100, itemCount: 1 }).ok).toBe(false)
    expect(canSend({ status: 'draft', total: 100, itemCount: 1 })).toEqual({ ok: true })
    expect(canSend({ status: 'sent', total: 100, itemCount: 1 })).toEqual({ ok: true })
  })
  it('canReopen só rejected/expired', () => {
    expect(canReopen('rejected')).toBe(true)
    expect(canReopen('expired')).toBe(true)
    expect(canReopen('sent')).toBe(false)
    expect(canReopen('approved')).toBe(false)
  })
  it('canDecideByReception draft/sent', () => {
    expect(canDecideByReception('draft')).toBe(true)
    expect(canDecideByReception('sent')).toBe(true)
    expect(canDecideByReception('approved')).toBe(false)
  })
  it('rótulos', () => {
    expect(lostReasonLabel('preco')).toBe('Achou caro')
    expect(LOST_REASONS).toHaveLength(7)
    expect(STAGE_LABEL.rejected).toBe('Perdido: recusado')
    expect(STAGE_LABEL.completed).toBe('Concluído')
  })
})
