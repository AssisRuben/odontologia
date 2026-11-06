/** Acrescenta `novo` ao texto atual, separando por um espaço (ou nada, após quebra de linha). */
export function appendText(atual: string, novo: string): string {
  const n = novo.trim()
  if (!n) return atual
  if (!atual) return n
  return /\n$/.test(atual) ? atual + n : `${atual} ${n}`
}
