import { describe, it, expect } from 'vitest'
import { calcularHorarios, type ProfissionalAgenda } from '@/lib/agente/agendamento/horarios'
import { formatHora, todayYmd } from '@/lib/messaging/time'

const TZ = 'America/Sao_Paulo'
const regras = { antecedencia_h: 0, dias_a_frente: 0, intervalo_min: 30 as const }
// 2026-11-09 é segunda-feira
const now = new Date('2026-11-09T10:00:00Z') // 07:00 em SP
const clinic = {
  '1': ['07:00', '20:00'] as [string, string],
  '2': ['07:00', '20:00'] as [string, string],
  '3': ['07:00', '20:00'] as [string, string],
}
const prof = (wh: ProfissionalAgenda['workingHours'], id = 'p1', nome = 'Dr. Carlos Mendes'): ProfissionalAgenda => ({ id, nome, workingHours: wh })
const dois = { '1': [['08:00', '12:00'], ['14:00', '18:00']] as [string, string][] }

function horas(cs: { start: string }[]) {
  return cs.map((c) => formatHora(new Date(c.start), TZ))
}
function run(over: Partial<Parameters<typeof calcularHorarios>[0]> = {}) {
  return calcularHorarios({ profissionais: [prof(dois)], ocupados: [], clinicHours: clinic, regras, duracaoMin: 30, now, timezone: TZ, ...over })
}

describe('calcularHorarios', () => {
  it('dois períodos, duração 30', () => {
    const h = horas(run())
    expect(h[0]).toBe('08:00')
    expect(h).not.toContain('12:00')
    expect(h).toContain('14:00')
    expect(h[h.length - 1]).toBe('17:30')
  })
  it('duração 60 com intervalo 30', () => {
    const h = horas(run({ duracaoMin: 60 }))
    expect(h[h.length - 1]).toBe('17:00')
    expect(h).toContain('11:00')
    expect(h).not.toContain('11:30')
  })
  it('clínica fechada no dia', () => {
    expect(run({ clinicHours: {} })).toEqual([])
  })
  it('recorta pelo horário da clínica', () => {
    const h = horas(run({ clinicHours: { '1': ['09:00', '17:00'] } }))
    expect(h[0]).toBe('09:00')
    expect(h[h.length - 1]).toBe('16:30')
  })
  it('antecedência de 24 h', () => {
    const n = new Date('2026-11-09T13:00:00Z') // 10:00 SP
    const cs = run({ regras: { ...regras, antecedencia_h: 24, dias_a_frente: 2 }, now: n, profissionais: [prof({ '1': [['08:00', '12:00']], '2': [['08:00', '12:00']] })] })
    const quando = cs.map((c) => `${todayYmd(new Date(c.start), TZ)} ${formatHora(new Date(c.start), TZ)}`)
    expect(quando[0]).toBe('2026-11-10 10:00')
  })
  it('consulta 09:00–09:30 ocupa só 09:00', () => {
    const o = [{ professional_id: 'p1', start: '2026-11-09T12:00:00.000Z', end: '2026-11-09T12:30:00.000Z' }]
    const h = horas(run({ ocupados: o }))
    expect(h).not.toContain('09:00')
    expect(h).toContain('08:30')
    expect(h).toContain('09:30')
  })
  it('consulta de outro profissional não bloqueia', () => {
    const o = [{ professional_id: 'p2', start: '2026-11-09T12:00:00.000Z', end: '2026-11-09T12:30:00.000Z' }]
    expect(horas(run({ ocupados: o }))).toContain('09:00')
  })
  it('working_hours inválido não gera horários', () => {
    expect(run({ profissionais: [prof({})] })).toEqual([])
  })
  it('fuso: 06/11 23:30 em SP, primeiro dia considerado é 06/11 local', () => {
    const n = new Date('2026-11-07T02:30:00Z')
    const cs = run({
      now: n,
      duracaoMin: 15,
      regras: { ...regras, dias_a_frente: 1 },
      profissionais: [prof({ '5': [['08:00', '12:00'], ['23:30', '23:59']], '6': [['08:00', '12:00']] })],
      clinicHours: { '5': ['07:00', '23:59'], '6': ['07:00', '20:00'] },
    })
    expect(todayYmd(new Date(cs[0].start), TZ)).toBe('2026-11-06')
    expect(formatHora(new Date(cs[0].start), TZ)).toBe('23:30')
    expect(cs.some((c) => todayYmd(new Date(c.start), TZ) === '2026-11-07')).toBe(true)
  })
  it('alinha ao múltiplo do intervalo', () => {
    const h = horas(run({ profissionais: [prof({ '1': [['08:10', '10:00']] })] }))
    expect(h).toEqual(['08:30', '09:00', '09:30'])
  })
  it('ordena por início e depois por nome', () => {
    const a = prof({ '1': [['08:00', '09:00']] }, 'a', 'Zeca')
    const b = prof({ '1': [['08:00', '09:00']] }, 'b', 'Ana')
    const cs = run({ profissionais: [a, b] })
    expect(cs.map((c) => c.professional_name)).toEqual(['Ana', 'Zeca', 'Ana', 'Zeca'])
  })
  it('inclui hoje e dias_a_frente dias seguintes', () => {
    const cs = run({ regras: { ...regras, dias_a_frente: 7 }, profissionais: [prof({ '1': [['08:00', '08:30']] })] })
    expect(cs).toHaveLength(2) // seg 09/11 e seg 16/11
  })
})
