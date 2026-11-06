export type AiErrorKind = 'invalid_key' | 'rate_limited' | 'unavailable' | 'timeout' | 'bad_output'

export class AiError extends Error {
  kind: AiErrorKind
  constructor(kind: AiErrorKind) {
    super(kind)
    this.name = 'AiError'
    this.kind = kind
  }
}

const GENERIC = 'Não foi possível organizar agora. Tente de novo.'

export function aiErrorResponse(kind: AiErrorKind): { status: number; error: string } {
  switch (kind) {
    case 'invalid_key':
      return { status: 422, error: 'A chave da OpenAI foi recusada. Confira em Configurações.' }
    case 'rate_limited':
      return { status: 429, error: 'A conta da OpenAI atingiu o limite. Tente mais tarde.' }
    default:
      return { status: 503, error: GENERIC }
  }
}

export const NO_KEY_ERROR = {
  status: 409,
  error: 'Cadastre a chave da OpenAI em Configurações → Inteligência artificial',
}
