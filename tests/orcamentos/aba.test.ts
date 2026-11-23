import { describe, expect, it } from 'vitest'
import { actionsFor, eventLabel, parseValidityDays, totalDoOrcamento } from '@/lib/orcamentos/aba'

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

describe('orçamento importado', () => {
  const nenhuma = {
    send: false, resend: false, copyLink: false, decide: false, reopen: false, receipt: false,
    charge: false, complete: false, editValidity: false, editProfessional: false, editItems: false,
  }

  it.each(['draft', 'sent', 'rejected', 'expired'] as const)('%s fica somente leitura', (status) => {
    expect(actionsFor(status, 100, true)).toEqual(nenhuma)
  })

  it.each(['approved', 'completed'] as const)('%s só mantém Gerar cobrança', (status) => {
    expect(actionsFor(status, 100, true)).toEqual({ ...nenhuma, charge: true })
    expect(actionsFor(status, 0, true)).toEqual(nenhuma)
  })

  it('orçamento normal continua editando itens', () => {
    expect(actionsFor('draft', 0).editItems).toBe(true)
  })

  it('importado usa sempre b.total', () => {
    expect(totalDoOrcamento({ status: 'draft', total: 300, approved_total: null, imported_from: 'codental' }, 120)).toBe(300)
    expect(totalDoOrcamento({ status: 'approved', total: '250.50' as unknown as number, approved_total: 999, imported_from: 'codental' }, 120)).toBe(250.5)
  })

  it('normal mantém a regra atual', () => {
    expect(totalDoOrcamento({ status: 'draft', total: 300, approved_total: null, imported_from: null }, 120)).toBe(120)
    expect(totalDoOrcamento({ status: 'approved', total: 300, approved_total: 200, imported_from: null }, 120)).toBe(200)
    expect(totalDoOrcamento({ status: 'approved', total: 300, approved_total: null }, 120)).toBe(120)
  })
})
