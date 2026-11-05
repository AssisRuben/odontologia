/**
 * Normaliza um telefone brasileiro para o formato canônico de celular:
 * `55` + DDD (2) + `9` + 8 dígitos (13 dígitos). Retorna `null` para fixos ou inválidos.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null

  let digits = raw.replace(/\D/g, '')
  if (digits.startsWith('0')) digits = digits.slice(1)

  if (digits.length === 10 || digits.length === 11) digits = '55' + digits

  // Celular antigo sem o 9 (ex.: JID do WhatsApp): 55 + DDD + 8 dígitos começando em 6–9
  if (digits.length === 12 && digits.startsWith('55') && /[6-9]/.test(digits[4])) {
    digits = digits.slice(0, 4) + '9' + digits.slice(4)
  }

  if (digits.length === 13 && digits.startsWith('55') && digits[4] === '9') return digits
  return null
}
