import { describe, expect, it } from 'vitest'
import { errorText, INVALID_KEY_MSG } from '@/components/pagamentos/errorText'

describe('errorText', () => {
  it('maps asaas_invalid_key to the reconnect message', () => {
    expect(errorText(409, { error: 'asaas_invalid_key' })).toBe(INVALID_KEY_MSG)
    expect(INVALID_KEY_MSG).toBe('A chave do Asaas não é mais válida. Reconecte o Asaas em Configurações → Pagamentos.')
  })
  it('hides raw codes behind a generic message', () => {
    expect(errorText(409, { error: 'invalid_fiscal_info' })).toBe('Não foi possível concluir a ação. Tente novamente.')
  })
  it('passes Portuguese messages through', () => {
    expect(errorText(409, { error: 'Já existe uma nota ativa para este pagamento' })).toBe('Já existe uma nota ativa para este pagamento')
  })
  it('falls back by status, with an optional custom fallback', () => {
    expect(errorText(500, null)).toBe('Erro interno. Tente novamente.')
    expect(errorText(400, {})).toBe('Não foi possível concluir a ação.')
    expect(errorText(400, null, 'Não foi possível emitir a nota.')).toBe('Não foi possível emitir a nota.')
    expect(errorText(503, null, 'Não foi possível emitir a nota.')).toBe('Erro interno. Tente novamente.')
  })
  it('ignores non-string error values', () => {
    expect(errorText(400, { error: 42 as unknown as string })).toBe('Não foi possível concluir a ação.')
  })
})
