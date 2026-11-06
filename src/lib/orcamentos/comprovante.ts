import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'
import { fit, safeText } from '@/lib/pdf/texto'
import { formatCpf } from '@/lib/payments/cpf'
import type { Snapshot } from './assinatura'
import { brDateFromInstant, maskCpfMiddle } from './datas'

function brl(text: string): string {
  const [int, dec] = text.split('.')
  return `R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec ?? '00'}`
}

function brDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

function brDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

export async function buildReceiptPdf(
  s: Snapshot,
  meta: { hash: string; ip: string | null; userAgent: string | null; provider: 'app' | 'reception'; maskCpf?: boolean },
): Promise<Uint8Array> {
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

  const need = (h: number) => {
    if (y - h < M) {
      page = doc.addPage([W, H])
      y = H - M
    }
  }
  const text = (t: string, x: number, size: number, f: PDFFont = font, color = ink) =>
    page.drawText(safeText(f, t), { x, y, size, font: f, color })
  const right = (t: string, xRight: number, size: number, f: PDFFont = font) => {
    const t2 = safeText(f, t)
    page.drawText(t2, { x: xRight - f.widthOfTextAtSize(t2, size), y, size, font: f, color: ink })
  }
  // Escreve um parágrafo com quebra de linha (inclui palavras longas como hash e user agent).
  const line = (t: string, size = 10, f: PDFFont = font, color = ink, gap = 15) => {
    const maxW = W - 2 * M
    const rows: string[] = []
    let cur = ''
    for (const w of safeText(f, t).split(' ')) {
      let piece = w
      while (f.widthOfTextAtSize(piece, size) > maxW) {
        let n = piece.length
        while (n > 1 && f.widthOfTextAtSize(piece.slice(0, n), size) > maxW) n--
        if (cur) {
          rows.push(cur)
          cur = ''
        }
        rows.push(piece.slice(0, n))
        piece = piece.slice(n)
      }
      const next = cur ? `${cur} ${piece}` : piece
      if (f.widthOfTextAtSize(next, size) <= maxW) cur = next
      else {
        rows.push(cur)
        cur = piece
      }
    }
    if (cur) rows.push(cur)
    for (const r of rows) {
      need(gap)
      page.drawText(r, { x: M, y, size, font: f, color })
      y -= gap
    }
  }

  line('Comprovante de aprovação de orçamento', 18, bold, ink, 24)
  line(s.clinica, 12, font, gray, 22)
  line(`Paciente: ${s.paciente}`)
  if (s.dentista) line(`Dentista: ${s.dentista}`)
  line(`Orçamento: ${s.orcamento}   Data: ${brDateFromInstant(s.data)}   Validade: ${s.validade ? brDate(s.validade) : 'não informada'}`)
  y -= 8

  const cols = { proc: M, tooth: M + 240, qty: M + 290, unitRight: M + 420, subRight: W - M }
  const header = () => {
    text('Procedimento', cols.proc, 9, bold)
    text('Dente', cols.tooth, 9, bold)
    text('Qtd', cols.qty, 9, bold)
    right('Valor unit.', cols.unitRight, 9, bold)
    right('Subtotal', cols.subRight, 9, bold)
    y -= 14
  }
  line('Itens aprovados', 11, bold, ink, 18)
  need(30)
  header()
  for (const i of s.itens_aprovados) {
    if (y < M + 20) {
      page = doc.addPage([W, H])
      y = H - M
      header()
    }
    text(fit(font, i.procedimento, 9, cols.tooth - cols.proc - 8), cols.proc, 9)
    text(i.dente ?? '-', cols.tooth, 9)
    text(String(i.quantidade), cols.qty, 9)
    right(brl(i.preco_unitario), cols.unitRight, 9)
    right(brl(i.subtotal), cols.subRight, 9)
    y -= 13
  }
  y -= 6
  need(20)
  text('Total aprovado', cols.proc, 11, bold)
  right(brl(s.total_aprovado), cols.subRight, 11, bold)
  y -= 24

  if (s.itens_nao_aprovados.length > 0) {
    line('Procedimentos não aprovados', 11, bold, ink, 18)
    for (const i of s.itens_nao_aprovados) line(`- ${i.procedimento}`, 9, font, ink, 13)
    y -= 10
  }

  line(`Assinante: ${s.assinante.nome}`)
  if (s.assinante.cpf) line(`CPF: ${meta.maskCpf ? maskCpfMiddle(s.assinante.cpf) : formatCpf(s.assinante.cpf)}`)
  line(`Data e hora: ${brDateTime(s.assinado_em)} (horário de Brasília)`)
  line(`IP: ${meta.ip ?? 'não informado'}`)
  line(`Dispositivo: ${meta.userAgent ?? 'não informado'}`)
  line(`Hash (SHA-256): ${meta.hash}`, 9, font, gray)
  y -= 8
  line(
    meta.provider === 'app'
      ? 'Assinado eletronicamente (Lei 14.063/2020, assinatura simples)'
      : 'Aprovado pela recepção, sem assinatura eletrônica do paciente',
    10,
    bold,
  )

  return doc.save()
}
