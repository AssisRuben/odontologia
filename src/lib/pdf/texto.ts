import type { PDFFont } from 'pdf-lib'

/** Troca por '?' os caracteres que a fonte WinAnsi não consegue codificar. */
export function safeText(font: PDFFont, text: string): string {
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

export function fit(font: PDFFont, text: string, size: number, maxWidth: number): string {
  let t = safeText(font, text)
  if (font.widthOfTextAtSize(t, size) <= maxWidth) return t
  while (t.length > 1 && font.widthOfTextAtSize(t + '...', size) > maxWidth) t = t.slice(0, -1)
  return t + '...'
}
