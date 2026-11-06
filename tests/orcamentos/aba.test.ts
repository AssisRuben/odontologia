import { describe, expect, it } from 'vitest'
import { actionsFor, eventLabel, parseValidityDays } from '@/lib/orcamentos/aba'

const ev = (p: object) => ({ type: 'sent', outcome: null, reason: null, created_by: null, ...p }) as Parameters<typeof eventLabel>[0]

describe('eventLabel', () => {
  it('mapeia eventos', () => {
    expect(eventLabel(ev({ type: 'viewed' }))).toBe('Visualizado pelo paciente')
    expect(eventLabel(ev({ type: 'contact', outcome: 'pensar' }))).toBe('Contato: Vai pensar')
    expect(eventLabel(ev({ type: 'approved' }))).toBe('Aprovado (assinado)')
    expect(eventLabel(ev({ type: 'approved', created_by: 'u' }))).toBe('Aprovado pela recepção')
    expect(eventLabel(ev({ type: 'rejected', reason: 'preco' }))).toBe('Perdido: Achou caro')
    expect(eventLabel(ev({ type: 'edited' }))).toBe('Editado (link desativado)')
  })
})

describe('actionsFor', () => {
  it('rascunho envia, enviado reenvia', () => {
    expect(actionsFor('draft', 0)).toMatchObject({ send: true, resend: false, decide: true })
    expect(actionsFor('sent', 0)).toMatchObject({ send: false, resend: true, copyLink: true, decide: true })
  })
  it('aprovado cobra só com saldo', () => {
    expect(actionsFor('approved', 100)).toMatchObject({ charge: true, complete: true, receipt: true })
    expect(actionsFor('approved', 0).charge).toBe(false)
    expect(actionsFor('completed', 50)).toMatchObject({ charge: true, complete: false })
    expect(actionsFor('draft', 50).charge).toBe(false)
  })
  it('perdido reabre', () => {
    expect(actionsFor('rejected', 0).reopen).toBe(true)
    expect(actionsFor('expired', 0).reopen).toBe(true)
  })
})

describe('parseValidityDays', () => {
  it('valida 1..180', () => {
    expect(parseValidityDays('30')).toEqual({ ok: true, days: 30 })
    for (const v of ['0', '181', '', '1.5', 'abc', '-3']) {
      expect(parseValidityDays(v)).toEqual({ ok: false, error: 'Informe de 1 a 180 dias' })
    }
  })
})
