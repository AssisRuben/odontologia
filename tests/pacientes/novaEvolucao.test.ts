import { describe, it, expect } from 'vitest'
import { inicioEvolucao, profissionalPadrao } from '@/lib/pacientes/novaEvolucao'

const profs = [
  { id: 'p1', user_id: 'u1' },
  { id: 'p2', user_id: null },
  { id: 'p3', user_id: 'u3' },
]
const hoje = new Date('2026-11-26T15:00:00')

describe('profissionalPadrao', () => {
  it('quem está usando o sistema, se for dentista', () => {
    expect(profissionalPadrao(profs, 'u3', ['p2'])).toBe('p3')
  })
  it('senão, quem atendeu o paciente por último', () => {
    expect(profissionalPadrao(profs, 'u9', ['p2', 'p1'])).toBe('p2')
  })
  it('senão, o primeiro dentista da clínica', () => {
    expect(profissionalPadrao(profs, null, [])).toBe('p1')
    expect(profissionalPadrao([], null, [])).toBe('')
  })
})

describe('inicioEvolucao', () => {
  it('pela agenda: vem da consulta', () => {
    const apt = { id: 'a1', patient_id: 'pa', professional_id: 'p2', start_time: '2026-11-20T10:00:00', patient: { name: 'Ana' } }
    expect(inicioEvolucao({ appointment: apt, hoje })).toEqual({
      patientId: 'pa', patientName: 'Ana', professionalId: 'p2', date: '2026-11-20', appointmentId: 'a1',
    })
  })
  it('pelo prontuário: sem consulta, data de hoje e o dentista padrão', () => {
    expect(inicioEvolucao({ appointment: null, paciente: { id: 'pa', name: 'Ana' }, profissionalInicial: 'p3', hoje })).toEqual({
      patientId: 'pa', patientName: 'Ana', professionalId: 'p3', date: '2026-11-26', appointmentId: null,
    })
  })
})
