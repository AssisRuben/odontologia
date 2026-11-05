function checkDigit(digits: number[], length: number): number {
  let sum = 0
  for (let i = 0; i < length; i++) sum += digits[i] * (length + 1 - i)
  const rest = (sum * 10) % 11
  return rest === 10 ? 0 : rest
}

/** Retorna os 11 dígitos se o CPF for válido, senão null. */
export function normalizeCpf(s: string): string | null {
  const only = (s ?? '').replace(/\D/g, '')
  if (only.length !== 11 || /^(\d)\1{10}$/.test(only)) return null
  const d = only.split('').map(Number)
  if (checkDigit(d, 9) !== d[9] || checkDigit(d, 10) !== d[10]) return null
  return only
}

export function isValidCpf(s: string): boolean {
  return normalizeCpf(s) !== null
}

/** Formata 11 dígitos como 000.000.000-00; devolve o texto original se não tiver 11 dígitos. */
export function formatCpf(s: string): string {
  const n = (s ?? '').replace(/\D/g, '')
  return n.length === 11 ? `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6, 9)}-${n.slice(9)}` : s
}
