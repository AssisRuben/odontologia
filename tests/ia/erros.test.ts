import { describe, expect, it } from 'vitest'
import { aiErrorResponse, NO_KEY_ERROR } from '@/lib/ia/erros'

describe('aiErrorResponse', () => {
  it('mapeia cada tipo para status e mensagem', () => {
    expect(aiErrorResponse('invalid_key')).toEqual({ status: 422, error: 'A chave da OpenAI foi recusada. Confira em Configurações.' })
    expect(aiErrorResponse('rate_limited')).toEqual({ status: 429, error: 'A conta da OpenAI atingiu o limite. Tente mais tarde.' })
    for (const k of ['unavailable', 'timeout', 'bad_output'] as const) {
      expect(aiErrorResponse(k)).toEqual({ status: 503, error: 'Não foi possível organizar agora. Tente de novo.' })
    }
  })

  it('erro de chave ausente', () => {
    expect(NO_KEY_ERROR).toEqual({ status: 409, error: 'Cadastre a chave da OpenAI em Configurações → Inteligência artificial' })
  })
})
