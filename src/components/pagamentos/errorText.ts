export const INVALID_KEY_MSG = 'A chave do Asaas não é mais válida. Reconecte o Asaas em Configurações → Pagamentos.'

/** Texto de erro para o usuário a partir da resposta de uma rota de pagamentos (nunca mostra códigos crus). */
export function errorText(status: number, data: { error?: unknown } | null, fallback?: string): string {
  const error = typeof data?.error === 'string' ? data.error : ''
  if (error === 'asaas_invalid_key') return INVALID_KEY_MSG
  if (error && /^[a-z_]+$/.test(error)) return 'Não foi possível concluir a ação. Tente novamente.'
  if (error) return error
  if (status >= 500) return 'Erro interno. Tente novamente.'
  return fallback ?? 'Não foi possível concluir a ação.'
}
