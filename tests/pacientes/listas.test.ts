import { describe, it, expect } from 'vitest'
import { aniversariantesDoMes, estadoDaLista, retornosPendentes } from '@/lib/pacientes/listas'

const p = (id: string, birthdate: string | null = null) => ({ id, name: id, birthdate })

describe('aniversariantesDoMes', () => {
  it('pega quem faz aniversário no mês, de qualquer ano, em ordem de dia', () => {
    const lista = [p('c', '1980-11-25'), p('a', '1990-11-03'), p('x', '1985-10-11'), p('s', null), p('b', '2001-11-11')]
    expect(aniversariantesDoMes(lista, '2026-11-11').map(x => x.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('retornosPendentes', () => {
  const agora = new Date('2026-11-11T12:00:00-03:00')
  const c = (patient_id: string, start_time: string, status: string) => ({ patient_id, start_time, status })

  it('lista quem teve a última consulta concluída há 6 meses ou mais, mais antigos primeiro', () => {
    const pacientes = [p('a'), p('b'), p('c'), p('d')]
    const consultas = [
      c('a', '2026-03-01T13:00:00Z', 'completed'),
      c('a', '2026-04-20T13:00:00Z', 'completed'),
      c('b', '2025-12-01T13:00:00Z', 'completed'),
      c('c', '2026-09-01T13:00:00Z', 'completed'), // veio há pouco
      c('d', '2026-01-01T13:00:00Z', 'no_show'),   // falta não conta como visita
    ]
    const r = retornosPendentes(pacientes, consultas, agora)
    expect(r.map(x => [x.paciente.id, x.ultima])).toEqual([
      ['b', '2025-12-01T13:00:00Z'],
      ['a', '2026-04-20T13:00:00Z'],
    ])
  })

  it('deixa de fora quem já tem consulta futura marcada', () => {
    const consultas = [
      c('a', '2026-01-10T13:00:00Z', 'completed'),
      c('a', '2026-11-20T13:00:00Z', 'scheduled'),
      c('b', '2026-01-10T13:00:00Z', 'completed'),
      c('b', '2026-11-20T13:00:00Z', 'cancelled'), // desmarcada não conta
    ]
    expect(retornosPendentes([p('a'), p('b')], consultas, agora).map(x => x.paciente.id)).toEqual(['b'])
  })

  it('exatamente 6 meses entra; um dia a menos não', () => {
    const consultas = [
      c('a', '2026-05-11T12:00:00-03:00', 'completed'),
      c('b', '2026-05-12T12:00:00-03:00', 'completed'),
    ]
    expect(retornosPendentes([p('a'), p('b')], consultas, agora).map(x => x.paciente.id)).toEqual(['a'])
  })
})

describe('estadoDaLista', () => {
  const base = { erroPacientes: false, erroConsultas: false, aba: 'buscar', carregando: false, quantidade: 0 }

  it('falha ao carregar pacientes nunca vira tela vazia', () => {
    expect(estadoDaLista({ ...base, erroPacientes: true })).toBe('erro-pacientes')
  })
  it('falha nos pacientes vale em todas as abas e antes do carregando', () => {
    for (const aba of ['buscar', 'aniversariantes', 'retornos']) {
      expect(estadoDaLista({ ...base, aba, erroPacientes: true, erroConsultas: true, carregando: true })).toBe('erro-pacientes')
    }
  })
  it('falha nas consultas só afeta a aba de retornos', () => {
    expect(estadoDaLista({ ...base, aba: 'retornos', erroConsultas: true })).toBe('erro-consultas')
    expect(estadoDaLista({ ...base, aba: 'buscar', erroConsultas: true, quantidade: 1 })).toBe('lista')
  })
  it('carregando, vazia e lista', () => {
    expect(estadoDaLista({ ...base, carregando: true })).toBe('carregando')
    expect(estadoDaLista(base)).toBe('vazia')
    expect(estadoDaLista({ ...base, quantidade: 2 })).toBe('lista')
  })
})
