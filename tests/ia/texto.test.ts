import { describe, it, expect } from 'vitest'
import { appendText } from '@/lib/ia/texto'

describe('appendText', () => {
  it('atual vazio devolve o novo sem espaços nas pontas', () => {
    expect(appendText('', ' oi ')).toBe('oi')
  })
  it('junta com um espaço', () => {
    expect(appendText('a', 'b')).toBe('a b')
  })
  it('não põe espaço depois de quebra de linha', () => {
    expect(appendText('a\n', 'b')).toBe('a\nb')
  })
  it('novo vazio mantém o atual', () => {
    expect(appendText('a', '  ')).toBe('a')
  })
})
