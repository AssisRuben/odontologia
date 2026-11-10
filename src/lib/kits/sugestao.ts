// Sugestão do kit de material para um procedimento.

/** Tira acentos, passa para minúsculas e junta espaços. */
export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Sugere o kit: o último usado (se ainda ativo) vence; senão, o kit ativo cujo
 * nome aparece no procedimento (o nome mais longo vence). Sem casamento, null.
 */
export function sugerirKit(
  procedimento: string,
  kits: { id: string; name: string; active: boolean }[],
  ultimoKitId?: string | null,
): string | null {
  if (ultimoKitId && kits.some((k) => k.id === ultimoKitId && k.active)) return ultimoKitId
  const proc = normalizar(procedimento)
  let melhor: { id: string; tam: number } | null = null
  for (const k of kits) {
    if (!k.active) continue
    const nome = normalizar(k.name)
    if (nome === '' || !proc.includes(nome)) continue
    if (!melhor || nome.length > melhor.tam) melhor = { id: k.id, tam: nome.length }
  }
  return melhor ? melhor.id : null
}
