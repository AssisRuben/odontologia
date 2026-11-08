import { describe, expect, it } from 'vitest'
import { aniversariantesDoDia } from '@/lib/avisos/aniversariantes'

describe('aniversariantesDoDia', () => {
  it('compara só dia e mês e ordena por nome', () => {
    const lista = aniversariantesDoDia([
      { id: '1', name: 'Bruno', birthdate: '1990-11-07' },
      { id: '2', name: 'Ana', birthdate: '1985-11-07' },
      { id: '3', name: 'Caio', birthdate: '1990-11-08' },
      { id: '4', name: 'Sem data', birthdate: null },
    ], '2026-11-07')
    expect(lista.map((p) => p.name)).toEqual(['Ana', 'Bruno'])
  })

  it('quem nasceu em 29/02 é lembrado em 28/02 nos anos não bissextos', () => {
    const p = [{ id: '1', name: 'Leap', birthdate: '2000-02-29' }]
    expect(aniversariantesDoDia(p, '2027-02-28')).toHaveLength(1)
    expect(aniversariantesDoDia(p, '2028-02-28')).toHaveLength(0)
    expect(aniversariantesDoDia(p, '2028-02-29')).toHaveLength(1)
  })
})
