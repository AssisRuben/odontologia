import { describe, it, expect } from 'vitest'
import { unzipSync } from 'fflate'
import type { Ledger, LedgerRow } from '@/lib/livro-caixa/apuracao'
import {
  MAX_ATTACHMENTS_BYTES,
  attachmentFileName,
  selectAttachments,
  toCsv,
  toPdf,
  toZip,
} from '@/lib/livro-caixa/exportacao'

function row(o: Partial<LedgerRow> = {}): LedgerRow {
  return {
    kind: 'receita',
    refId: 'abcdef12-0000',
    date: '2026-11-05',
    description: 'Limpeza',
    category: null,
    group: null,
    amountCents: 123456,
    payerName: 'Ana',
    payerCpf: '12345678909',
    patientName: 'Ana',
    receiptIssued: true,
    attachmentPath: null,
    attachmentName: null,
    attachmentSize: null,
    ...o,
  }
}

function ledger(rows: LedgerRow[]): Ledger {
  return {
    month: '2026-11',
    totals: {
      patientRevenueCents: 123456,
      insuranceRevenueCents: 0,
      custeioCents: 1000,
      feesCents: 0,
      pessoalCents: 0,
      emolumentosCents: 0,
      deductibleCents: 1000,
      nonDeductibleCents: 0,
      resultCents: 122456,
    },
    rows,
    receipts: [],
    alerts: { pendingReceipts: 1, receiptsWithoutCpf: 0, deductibleWithoutAttachment: 0 },
  }
}

describe('toCsv', () => {
  it('csv starts with BOM and header', () => {
    const csv = toCsv(ledger([]))
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.slice(1).split('\r\n')[0]).toBe(
      'Data;Tipo;Descrição;Categoria;Grupo Carnê-Leão;Valor;Pagador;CPF do pagador;Paciente;Recibo emitido;Comprovante',
    )
  })

  it('csv uses comma decimals and dd/mm/yyyy', () => {
    const line = toCsv(ledger([row()])).split('\r\n')[1]
    expect(line.startsWith('05/11/2026;Receita de paciente;Limpeza;;;1234,56;Ana;12345678909;Ana;Sim;')).toBe(true)
  })

  it('quotes fields with separator, quotes and newlines', () => {
    const csv = toCsv(ledger([row({ description: 'Ana; "filha"\nok' })]))
    expect(csv).toContain('"Ana; ""filha""\nok"')
  })

  it('neutralizes formula injection in text fields but not in money', () => {
    const r = row({ description: '=HYPERLINK("x")', payerName: '+cmd', patientName: '-1', amountCents: -500 })
    const line = toCsv(ledger([r])).split('\r\n')[1]
    expect(line).toContain(`;"'=HYPERLINK(""x"")";`)
    expect(line).toContain(";-5,00;'+cmd;")
    expect(line).toContain(";'-1;")
    const at = toCsv(ledger([row({ description: '@x' })])).split('\r\n')[1]
    expect(at).toContain(";'@x;")
  })

  it('keeps accents', () => {
    const csv = toCsv(ledger([row({ receiptIssued: false })]))
    expect(csv).toContain('Descrição')
    expect(csv).toContain('Não')
  })

  it('fills category, group and attachment for expenses', () => {
    const r = row({
      kind: 'despesa', category: 'material', group: 'custeio', receiptIssued: null,
      payerName: null, payerCpf: null, patientName: null,
      attachmentPath: 'c/e/u.pdf', attachmentName: 'nota.pdf',
    })
    const line = toCsv(ledger([r])).split('\r\n')[1]
    expect(line).toContain(';Despesa;Limpeza;Material odontológico;Despesas de custeio;1234,56;;;;;comprovantes/2026-11-05-limpeza-abcdef12.pdf')
  })
})

describe('attachmentFileName', () => {
  it('attachmentFileName slugs and keeps extension', () => {
    const name = attachmentFileName(
      row({ description: 'Conta de luz — Março', attachmentName: 'foto.JPG', attachmentPath: 'a/b/c.jpg' }),
    )
    expect(name.startsWith('comprovantes/2026-11-05-conta-de-luz-marco-')).toBe(true)
    expect(name.endsWith('-abcdef12.jpg')).toBe(true)
  })

  it('falls back to path extension', () => {
    expect(attachmentFileName(row({ attachmentName: null, attachmentPath: 'a/b/c.PNG' }))).toMatch(/\.png$/)
  })
})

describe('selectAttachments', () => {
  it('selectAttachments skips all above 100 MB', () => {
    const rows = [
      row({ attachmentPath: 'a', attachmentSize: MAX_ATTACHMENTS_BYTES }),
      row({ attachmentPath: 'b', attachmentSize: 1 }),
    ]
    expect(selectAttachments(rows)).toEqual({ included: [], skipped: true })
  })

  it('includes rows with attachments under the limit', () => {
    const rows = [row({ attachmentPath: 'a', attachmentSize: null }), row()]
    const r = selectAttachments(rows)
    expect(r.skipped).toBe(false)
    expect(r.included).toHaveLength(1)
  })
})

describe('toPdf / toZip', () => {
  it('toPdf returns a pdf', async () => {
    const bytes = await toPdf(ledger([row(), row({ description: 'Emoji 😀 ação' })]), 'Clínica Ânne')
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('%PDF')
  })

  it('toPdf paginates many rows', async () => {
    const rows = Array.from({ length: 150 }, () => row())
    const bytes = await toPdf(ledger(rows), 'Clínica')
    expect(bytes.length).toBeGreaterThan(1000)
  })

  it('toZip contains given names', () => {
    const z = toZip({
      'resumo.pdf': new Uint8Array([1]),
      'lancamentos.csv': new Uint8Array([2]),
      'comprovantes/x.pdf': new Uint8Array([3]),
    })
    expect(Object.keys(unzipSync(z)).sort()).toEqual(['comprovantes/x.pdf', 'lancamentos.csv', 'resumo.pdf'])
  })
})
