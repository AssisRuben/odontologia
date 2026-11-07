import { describe, it, expect } from 'vitest'
import {
  criarOfertas, ofertaValida, apelidos, formatHora, textoLista, textoMarcada, textoRemarcada, textoDesmarcada,
  type Oferta, type ConsultaFutura,
} from '@/lib/agente/agendamento/ofertas'

const TZ = 'America/Sao_Paulo'
const now = new Date('2026-11-06T17:00:00Z')
const cand = (start: string, name = 'Dr. Carlos Mendes') => ({ professional_id: 'p1', professional_name: name, start, end: start })
const lista = criarOfertas([cand('2026-11-11T11:30:00Z'), cand('2026-11-12T13:00:00Z', 'Dra. Ana')], 'Avaliação', now)

describe('formatHora', () => {
  it('formata', () => {
    expect(formatHora(new Date('2026-11-11T11:30:00Z'), TZ)).toBe('8h30')
    expect(formatHora(new Date('2026-11-11T13:00:00Z'), TZ)).toBe('10h')
  })
})

describe('ofertas', () => {
  it('criarOfertas numera e define validade', () => {
    expect(lista.map((o) => o.n)).toEqual([1, 2])
    expect(lista[0].tipo).toBe('Avaliação')
    expect(lista[0].expires_at).toBe('2026-11-06T19:00:00.000Z')
  })
  it('ofertaValida', () => {
    expect(ofertaValida(lista, 1, now)?.n).toBe(1)
    expect(ofertaValida(lista, 1, new Date('2026-11-06T19:00:01Z'))).toBeNull()
    expect(ofertaValida(lista, 6, now)).toBeNull()
  })
})

describe('apelidos', () => {
  it('3 primeiras por início', () => {
    const cs: ConsultaFutura[] = ['2026-11-14', '2026-11-10', '2026-11-12', '2026-11-11'].map((d, i) => ({
      id: `i${i}`, start: `${d}T13:00:00Z`, procedure: null, professional: null,
    }))
    const r = apelidos(cs)
    expect(r.map((x) => x.alias)).toEqual(['C1', 'C2', 'C3'])
    expect(r.map((x) => x.consulta.start.slice(0, 10))).toEqual(['2026-11-10', '2026-11-11', '2026-11-12'])
  })
})

describe('textos', () => {
  it('textoLista', () => {
    expect(textoLista(lista, TZ, false)).toBe(
      '1) qua 11/11 às 8h30 com Dr. Carlos Mendes\n2) qui 12/11 às 10h com Dra. Ana\nQual prefere? Responda com o número.',
    )
  })
  it('textoLista relaxou', () => {
    expect(textoLista(lista, TZ, true).startsWith('Não achei nesse dia ou período; estes são os mais próximos:\n1) ')).toBe(true)
  })
  it('textoMarcada', () => {
    const o: Oferta = lista[0]
    expect(textoMarcada(o, null, TZ)).toBe('Pronto! Avaliação marcada para quarta-feira, 11/11, às 8h30 com Dr. Carlos Mendes.')
    expect(textoMarcada(o, 'Rua A, 1', TZ)).toBe('Pronto! Avaliação marcada para quarta-feira, 11/11, às 8h30 com Dr. Carlos Mendes. Endereço: Rua A, 1.')
  })
  it('textoRemarcada e textoDesmarcada', () => {
    expect(textoRemarcada(lista[1], TZ)).toBe('Pronto! Sua consulta foi remarcada para quinta-feira, 12/11, às 10h com Dra. Ana.')
    expect(textoDesmarcada({ id: 'x', start: '2026-11-11T11:30:00Z', procedure: null, professional: null }, TZ))
      .toBe('Consulta de 11/11 às 8h30 desmarcada. Se quiser marcar outra data, é só pedir.')
  })
})
