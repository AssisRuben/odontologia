import { describe, it, expect } from 'vitest'
import { normalizar, sugerirKit } from '@/lib/kits/sugestao'

const k = (id: string, name: string, active = true) => ({ id, name, active })

describe('sugerirKit', () => {
  it('casa ignorando acento, caixa e espaços', () => {
    expect(sugerirKit('RESTAURAÇÃO  resina', [k('k1', 'Restauracao Resina')])).toBe('k1')
  })
  it('o nome mais longo vence', () => {
    const kits = [k('k1', 'Restauração'), k('k2', 'Restauração resina')]
    expect(sugerirKit('Restauração resina classe II', kits)).toBe('k2')
  })
  it('último kit ativo vence o casamento por nome', () => {
    const kits = [k('k1', 'Restauração'), k('k2', 'Outro')]
    expect(sugerirKit('Restauração', kits, 'k2')).toBe('k2')
  })
  it('último kit inativo é ignorado', () => {
    const kits = [k('k1', 'Restauração'), k('k2', 'Outro', false)]
    expect(sugerirKit('Restauração', kits, 'k2')).toBe('k1')
  })
  it('kit inativo nunca é sugerido', () => {
    expect(sugerirKit('Restauração', [k('k1', 'Restauração', false)])).toBeNull()
  })
  it('sem casamento dá null', () => {
    expect(sugerirKit('Extração', [k('k1', 'Restauração')])).toBeNull()
  })
  it('normalizar', () => {
    expect(normalizar(' Ápice  X ')).toBe('apice x')
  })
})
