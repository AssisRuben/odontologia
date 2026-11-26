import { describe, it, expect } from 'vitest'
import { aplicarSituacao, lerSituacao, opcoesSituacao, rotuloSituacao, valorDaSituacao } from '@/lib/agenda/situacao'

describe('situação da consulta com quem cancelou', () => {
  it('valorDaSituacao junta a situação e quem cancelou', () => {
    expect(valorDaSituacao('cancelled', 'patient')).toBe('cancelled:patient')
    expect(valorDaSituacao('cancelled', null)).toBe('cancelled')
    expect(valorDaSituacao('confirmed', 'patient')).toBe('confirmed')
  })

  it('lerSituacao separa o que gravar', () => {
    expect(lerSituacao('cancelled:professional')).toEqual({ status: 'cancelled', cancelled_by: 'professional' })
    expect(lerSituacao('completed')).toEqual({ status: 'completed', cancelled_by: null })
    expect(lerSituacao('cancelled')).toEqual({ status: 'cancelled', cancelled_by: null })
  })

  it('rotuloSituacao diz quem cancelou', () => {
    expect(rotuloSituacao('cancelled', 'patient')).toBe('Cancelado pelo paciente')
    expect(rotuloSituacao('cancelled', 'professional')).toBe('Cancelado pelo dentista')
    expect(rotuloSituacao('cancelled', null)).toBe('Cancelado')
    expect(rotuloSituacao('no_show')).toBe('Faltou')
  })

  it('a lista oferece os dois cancelamentos no lugar de "Cancelado"', () => {
    expect(opcoesSituacao('confirmed').map((o) => o.label)).toEqual([
      'Agendado', 'Confirmado', 'Aguardando', 'Em atendimento', 'Concluído',
      'Cancelado pelo paciente', 'Cancelado pelo dentista', 'Faltou',
    ])
  })

  it('cancelamento antigo continua na lista só para a própria consulta', () => {
    const antigas = opcoesSituacao('cancelled')
    const i = antigas.findIndex((o) => o.value === 'cancelled')
    expect(antigas[i]).toEqual({ value: 'cancelled', label: 'Cancelado' })
    expect(antigas[i + 1].label).toBe('Cancelado pelo paciente')
    expect(opcoesSituacao('cancelled:patient').some((o) => o.value === 'cancelled')).toBe(false)
  })
})

describe('aplicarSituacao', () => {
  it('a consulta passada para "Editar" leva a situação escolhida no popup', () => {
    const apt = { id: 'a1', status: 'confirmed' as const, cancelled_by: null, notes: 'x' }
    expect(aplicarSituacao(apt, 'cancelled:professional')).toEqual({ id: 'a1', status: 'cancelled', cancelled_by: 'professional', notes: 'x' })
    expect(aplicarSituacao({ ...apt, status: 'cancelled' as const, cancelled_by: 'patient' as const }, 'completed'))
      .toMatchObject({ status: 'completed', cancelled_by: null })
  })
})
