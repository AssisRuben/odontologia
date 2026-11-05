import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'
import { zipSync } from 'fflate'
import type { Ledger, LedgerRow, RowKind } from './apuracao'
import { categoryLabel, groupLabel } from './categorias'
import { monthLabel } from './mes'

export const MAX_ATTACHMENTS_BYTES = 100 * 1024 * 1024
export const SKIPPED_NOTE =
  'Os comprovantes deste mês passam de 100 MB e não foram incluídos. Baixe-os pela tela de Despesas.'
export const DISCLAIMER = 'Valores para conferência. O cálculo oficial do imposto é feito no Carnê-Leão Web.'

const KIND_LABEL: Record<RowKind, string> = {
  receita: 'Receita de paciente',
  convenio: 'Convênio',
  despesa: 'Despesa',
  tarifa: 'Tarifa de cobrança',
}

const CSV_HEADER = [
  'Data', 'Tipo', 'Descrição', 'Categoria', 'Grupo Carnê-Leão', 'Valor',
  'Pagador', 'CPF do pagador', 'Paciente', 'Recibo emitido', 'Comprovante',
]

function brDate(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  return `${d}/${m}/${y}`
}

function csvMoney(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`
}

function pdfMoney(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const int = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${sign}R$ ${int},${String(abs % 100).padStart(2, '0')}`
}

function csvField(v: string): string {
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function extensionOf(name: string | null): string {
  const m = name?.match(/\.([A-Za-z0-9]{1,8})$/)
  return m ? m[1].toLowerCase() : ''
}

export function attachmentFileName(row: LedgerRow): string {
  const slug = row.description
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  const ext = extensionOf(row.attachmentName) || extensionOf(row.attachmentPath)
  const base = `comprovantes/${row.date}-${slug}-${row.refId.slice(0, 8)}`
  return ext ? `${base}.${ext}` : base
}

export function toCsv(ledger: Ledger): string {
  const lines = [CSV_HEADER.join(';')]
  for (const r of ledger.rows) {
    const isExpense = r.kind === 'despesa' || r.kind === 'tarifa'
    const fields = [
      brDate(r.date),
      KIND_LABEL[r.kind],
      r.description,
      r.kind === 'despesa' ? categoryLabel(r.category) : '',
      isExpense ? groupLabel(r.group) : '',
      csvMoney(r.amountCents),
      r.payerName ?? '',
      r.payerCpf ?? '',
      r.patientName ?? '',
      r.kind === 'receita' && r.receiptIssued !== null ? (r.receiptIssued ? 'Sim' : 'Não') : '',
      r.attachmentPath ? attachmentFileName(r) : '',
    ]
    lines.push(fields.map(csvField).join(';'))
  }
  return '﻿' + lines.join('\r\n') + '\r\n'
}

export function selectAttachments(rows: LedgerRow[]): { included: LedgerRow[]; skipped: boolean } {
  const withFile = rows.filter((r) => r.attachmentPath)
  const total = withFile.reduce((s, r) => s + (r.attachmentSize ?? 0), 0)
  if (total > MAX_ATTACHMENTS_BYTES) return { included: [], skipped: true }
  return { included: withFile, skipped: false }
}

export function toZip(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files)
}

function safeText(font: PDFFont, text: string): string {
  let out = ''
  for (const ch of text.replace(/\s+/g, ' ')) {
    try {
      font.encodeText(ch)
      out += ch
    } catch {
      out += '?'
    }
  }
  return out
}

function fit(font: PDFFont, text: string, size: number, maxWidth: number): string {
  let t = safeText(font, text)
  if (font.widthOfTextAtSize(t, size) <= maxWidth) return t
  while (t.length > 1 && font.widthOfTextAtSize(t + '...', size) > maxWidth) t = t.slice(0, -1)
  return t + '...'
}

export async function toPdf(ledger: Ledger, clinicName: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const W = 595.28
  const H = 841.89
  const M = 40
  const ink = rgb(0.067, 0.094, 0.153)
  const gray = rgb(0.42, 0.45, 0.5)

  let page = doc.addPage([W, H])
  let y = H - M

  const text = (t: string, x: number, size: number, f: PDFFont = font, color = ink) =>
    page.drawText(safeText(f, t), { x, y, size, font: f, color })
  const right = (t: string, xRight: number, size: number, f: PDFFont = font) => {
    const s = safeText(f, t)
    page.drawText(s, { x: xRight - f.widthOfTextAtSize(s, size), y, size, font: f, color: ink })
  }

  text(`Livro-caixa — ${monthLabel(ledger.month)}`, M, 18, bold)
  y -= 20
  text(clinicName, M, 12, font, gray)
  y -= 26

  const t = ledger.totals
  const totals: [string, number, boolean][] = [
    ['Receitas de pacientes', t.patientRevenueCents, false],
    ['Despesas de custeio', t.custeioCents, false],
    ['Tarifas de cobrança (Asaas)', t.feesCents, false],
    ['Salários e encargos', t.pessoalCents, false],
    ['Emolumentos', t.emolumentosCents, false],
    ['Total dedutível', t.deductibleCents, true],
    ['Resultado do mês', t.resultCents, true],
    ['Recebimentos de convênios', t.insuranceRevenueCents, false],
    ['Despesas não dedutíveis', t.nonDeductibleCents, false],
  ]
  for (const [label, cents, strong] of totals) {
    text(label, M, 11, strong ? bold : font)
    right(pdfMoney(cents), W - M, 11, strong ? bold : font)
    y -= 16
  }

  y -= 6
  const issued = ledger.receipts.filter((r) => r.issuedAt).length
  const pending = ledger.receipts.length - issued
  text(`Recibos do Receita Saúde: ${issued} emitidos, ${pending} pendentes`, M, 10, font, gray)
  y -= 16
  text(DISCLAIMER, M, 10, font, gray)
  y -= 30

  const cols = { date: M, type: M + 62, desc: M + 170, valueRight: W - M }
  const header = () => {
    text('Data', cols.date, 9, bold)
    text('Tipo', cols.type, 9, bold)
    text('Descrição', cols.desc, 9, bold)
    right('Valor', cols.valueRight, 9, bold)
    y -= 14
  }
  header()
  for (const r of ledger.rows) {
    if (y < M + 20) {
      page = doc.addPage([W, H])
      y = H - M
      header()
    }
    text(brDate(r.date), cols.date, 9)
    text(KIND_LABEL[r.kind], cols.type, 9)
    text(fit(font, r.description, 9, cols.valueRight - 80 - cols.desc), cols.desc, 9)
    right(pdfMoney(r.amountCents), cols.valueRight, 9)
    y -= 13
  }

  return doc.save()
}
