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
