import { describe, it, expect } from 'vitest'
import { faixaAgenda } from '@/lib/agenda/faixa'

// Horários locais (sem fuso no texto = hora local do navegador/teste).
const c = (inicio: string, fim: string) => ({ start_time: `2026-11-27T${inicio}:00`, end_time: `2026-11-27T${fim}:00` })

describe('faixaAgenda', () => {
  it('sem consultas, vai das 7h às 21h', () => {
    expect(faixaAgenda([])).toEqual({ inicio: '07:00:00', fim: '21:00:00' })
  })

  it('consulta das 17h30 às 18h30 cabe na faixa padrão', () => {
    expect(faixaAgenda([c('17:30', '18:30')])).toEqual({ inicio: '07:00:00', fim: '21:00:00' })
  })

  it('consulta antes das 7h estica o início, arredondando para a meia hora de baixo', () => {
    expect(faixaAgenda([c('06:40', '07:20')])).toEqual({ inicio: '06:30:00', fim: '21:00:00' })
  })

  it('consulta depois das 21h estica o fim, arredondando para a meia hora de cima', () => {
    expect(faixaAgenda([c('20:30', '21:10')])).toEqual({ inicio: '07:00:00', fim: '21:30:00' })
  })

  it('consulta que passa da meia-noite para no fim do dia', () => {
    expect(faixaAgenda([{ start_time: '2026-11-27T23:00:00', end_time: '2026-11-28T00:30:00' }])).toEqual({ inicio: '07:00:00', fim: '24:00:00' })
  })

  it('data inválida é ignorada', () => {
    expect(faixaAgenda([{ start_time: 'x', end_time: 'y' }])).toEqual({ inicio: '07:00:00', fim: '21:00:00' })
  })
})
