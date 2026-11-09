import { describe, it, expect } from 'vitest'
import { mesesJanela, mesDoInstante } from '@/lib/indicadores/periodo'

describe('periodo', () => {
  it('janela atravessa o ano', () => {
    expect(mesesJanela('2026-02')).toEqual(['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02'])
  })
  it('mês pela hora de São Paulo', () => {
    expect(mesDoInstante('2026-11-01T01:00:00Z')).toBe('2026-10')
    expect(mesDoInstante('2026-11-01T03:00:00Z')).toBe('2026-11')
  })
})
