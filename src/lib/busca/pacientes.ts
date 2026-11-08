// Filtro do PostgREST (`.or(...)`) para a busca rápida de pacientes.

const CAMPOS = ['name', 'phone', 'whatsapp', 'cpf'] as const

/** Monta o filtro `.or()` para o termo digitado; null se o termo for curto demais. */
export function filtroBuscaPaciente(termo: string): string | null {
  // Vírgula, parênteses, % e * mudam o sentido do filtro do PostgREST.
  const limpo = termo.replace(/[,()%*\\]/g, '').trim()
  if (limpo.length < 2) return null
  const partes = CAMPOS.map((c) => `${c}.ilike.%${limpo}%`)
  // "11 9999" ou "123.456" também acham telefone/CPF salvos sem máscara.
  const digitos = limpo.replace(/\D/g, '')
  if (digitos.length >= 3 && /^[\d\s().\-/]+$/.test(limpo) && digitos !== limpo) {
    partes.push(`phone.ilike.%${digitos}%`, `whatsapp.ilike.%${digitos}%`, `cpf.ilike.%${digitos}%`)
  }
  return partes.join(',')
}
