import { describe, it, expect } from 'vitest'
import { renderTemplate, findUnknownVariables, buildContext } from '@/lib/messaging/templates'
import { zonedDateTime, todayYmd } from '@/lib/messaging/time'
import type { PatientRow } from '@/lib/messaging/types'

const patient: PatientRow = {
  id: 'p1', name: 'Maria Silva Santos', phone: null, whatsapp: null, birthdate: null, whatsapp_opt_out: false,
}

describe('renderTemplate', () => {
  it('substitui variáveis', () => {
    expect(renderTemplate('Oi {paciente} às {hora}', { paciente: 'Maria', hora: '14:30' })).toBe('Oi Maria às 14:30')
  })
  it('variável conhecida sem valor vira vazio', () => {
    expect(renderTemplate('{paciente}|{valor}', { paciente: 'A' })).toBe('A|')
  })
  it('variável desconhecida fica literal', () => {
    expect(renderTemplate('Oi {pacinete}', {})).toBe('Oi {pacinete}')
    expect(findUnknownVariables('Oi {pacinete} {paciente}')).toEqual(['pacinete'])
  })
})

describe('buildContext', () => {
  it('monta contexto da consulta', () => {
    const ctx = buildContext({
      patient, clinicName: 'Clínica X', tz: 'America/Sao_Paulo',
      appointment: { id: 'a1', patient_id: 'p1', professional_name: 'Dr. João', start_time: '2026-11-04T17:30:00Z', status: 'scheduled' },
    })
    expect(ctx.paciente).toBe('Maria')
    expect(ctx.paciente_completo).toBe('Maria Silva Santos')
    expect(ctx.data).toBe('quarta, 04/11')
    expect(ctx.hora).toBe('14:30')
    expect(ctx.profissional).toBe('Dr. João')
    expect(ctx.clinica).toBe('Clínica X')
  })
  it('monta contexto do pagamento', () => {
    const ctx = buildContext({
      patient, clinicName: 'C', tz: 'America/Sao_Paulo',
      payment: { id: 'x', patient_id: 'p1', amount: 150, due_date: '2026-11-04', status: 'pending' },
    })
    expect(ctx.valor).toBe('R$ 150,00')
    expect(ctx.vencimento).toBe('04/11/2026')
  })
})

describe('time', () => {
  it('zonedDateTime', () => {
    expect(zonedDateTime('2026-11-04', '09:00', 'America/Sao_Paulo').toISOString()).toBe('2026-11-04T12:00:00.000Z')
  })
  it('todayYmd respeita o fuso', () => {
    expect(todayYmd(new Date('2026-11-05T01:00:00Z'), 'America/Sao_Paulo')).toBe('2026-11-04')
  })
})
