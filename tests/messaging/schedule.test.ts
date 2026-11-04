import { describe, it, expect } from 'vitest'
import { planMessages, staleReason, dedupeKey, type PlanInput } from '@/lib/messaging/schedule'
import { DEFAULT_TEMPLATES } from '@/lib/messaging/templates'
import type { MessageSetting, MessageType, PatientRow, AppointmentRow, PaymentRow } from '@/lib/messaging/types'

const cfg = { window_start: '08:00', window_end: '20:00', daily_limit: 100, timezone: 'America/Sao_Paulo' }
const NOW = new Date('2026-11-03T13:00:00Z')

const configs: Record<MessageType, MessageSetting['config']> = {
  confirmation: { offset_hours: 24 },
  reminder: { offset_hours: 2 },
  recall: { offset_months: 6 },
  birthday: {},
  charge: { offset_days: [1, 7] },
  payment_due: { offset_days: [3] },
}
function settings(over: Partial<Record<MessageType, boolean>> = {}): MessageSetting[] {
  return (Object.keys(configs) as MessageType[]).map((type) => ({
    type, enabled: over[type] ?? true, template: DEFAULT_TEMPLATES[type], config: configs[type],
  }))
}
const patient = (o: Partial<PatientRow> = {}): PatientRow => ({
  id: 'p1', name: 'Maria Souza', phone: null, whatsapp: '11987654321', birthdate: null, whatsapp_opt_out: false, ...o,
})
const appt = (o: Partial<AppointmentRow> = {}): AppointmentRow => ({
  id: 'a1', patient_id: 'p1', professional_name: 'Dr. João', start_time: '2026-11-04T12:00:00Z', status: 'scheduled', ...o,
})
const pay = (o: Partial<PaymentRow> = {}): PaymentRow => ({
  id: 'pay1', patient_id: 'p1', amount: 150, due_date: '2026-11-02', status: 'pending', ...o,
})
function input(o: Partial<PlanInput> = {}): PlanInput {
  return {
    now: NOW, clinicId: 'c1', clinicName: 'Clínica X', cfg, settings: settings(),
    patients: new Map([['p1', patient()]]),
    upcoming: [], lastCompleted: [], patientsWithFuture: new Set(), payments: [], ...o,
  }
}
const withPatient = (p: Partial<PatientRow>) => new Map([['p1', patient(p)]])

describe('planMessages - confirmation/reminder', () => {
  it('planeja confirmação dentro de 24h', () => {
    const items = planMessages(input({ upcoming: [appt()] }))
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      type: 'confirmation', clinic_id: 'c1', patient_id: 'p1', appointment_id: 'a1', payment_id: null,
      phone: '5511987654321',
      dedupe_key: 'confirmation:a1:2026-11-04T12:00:00.000Z',
    })
    expect(items[0].scheduled_for).toEqual(NOW)
    expect(items[0].expires_at).toEqual(new Date('2026-11-04T12:00:00Z'))
  })
  it('normaliza start_time com offset na chave', () => {
    const items = planMessages(input({ upcoming: [appt({ start_time: '2026-11-04T12:00:00+00:00' })] }))
    expect(items[0].dedupe_key).toBe('confirmation:a1:2026-11-04T12:00:00.000Z')
  })
  it('não planeja confirmação 25h depois', () => {
    expect(planMessages(input({ upcoming: [appt({ start_time: '2026-11-04T14:00:00Z' })] }))).toEqual([])
  })
  it('reminder só para confirmed', () => {
    const start_time = '2026-11-03T14:00:00Z'
    const r = planMessages(input({ upcoming: [appt({ start_time, status: 'confirmed' })] }))
    expect(r.map((i) => i.type)).toEqual(['reminder'])
    expect(planMessages(input({ upcoming: [appt({ start_time })] })).map((i) => i.type)).toEqual(['confirmation'])
  })
  it('ignora opt-out, telefone fixo e tipo desabilitado', () => {
    expect(planMessages(input({ upcoming: [appt()], patients: withPatient({ whatsapp_opt_out: true }) }))).toEqual([])
    expect(planMessages(input({ upcoming: [appt()], patients: withPatient({ whatsapp: null, phone: '1134567890' }) }))).toEqual([])
    expect(planMessages(input({ upcoming: [appt()], settings: settings({ confirmation: false }) }))).toEqual([])
  })
  it('usa phone quando whatsapp ausente; ignora paciente desconhecido', () => {
    const items = planMessages(input({ upcoming: [appt()], patients: withPatient({ whatsapp: null, phone: '11987654321' }) }))
    expect(items[0].phone).toBe('5511987654321')
    expect(planMessages(input({ upcoming: [appt({ patient_id: 'zz' })] }))).toEqual([])
  })
  it('renderiza o corpo', () => {
    const [i] = planMessages(input({ upcoming: [appt()] }))
    expect(i.body).toContain('Responda *1* para confirmar')
    expect(i.body).toContain('Maria')
  })
})

describe('planMessages - recall', () => {
  const last = (start_time: string) => [{ patient_id: 'p1', appointment_id: 'a9', start_time }]
  it('planeja recall após 6 meses', () => {
    const [i] = planMessages(input({ lastCompleted: last('2026-05-01T12:00:00Z') }))
    expect(i).toMatchObject({ type: 'recall', dedupe_key: 'recall:p1:a9', expires_at: null, appointment_id: null })
    expect(i.scheduled_for).toEqual(new Date('2026-11-03T11:00:00Z'))
  })
  it('não planeja com consulta futura ou recente', () => {
    expect(planMessages(input({ lastCompleted: last('2026-05-01T12:00:00Z'), patientsWithFuture: new Set(['p1']) }))).toEqual([])
    expect(planMessages(input({ lastCompleted: last('2026-06-01T12:00:00Z') }))).toEqual([])
  })
})

describe('planMessages - recall (limite de atraso)', () => {
  const last = (start_time: string) => [{ patient_id: 'p1', appointment_id: 'a9', start_time }]
  it('33 dias de atraso ou mais → nada', () => {
    expect(planMessages(input({ lastCompleted: last('2026-04-01T12:00:00Z') }))).toEqual([])
    expect(planMessages(input({ lastCompleted: last('2024-01-10T12:00:00Z') }))).toEqual([])
  })
})

describe('planMessages - birthday', () => {
  it('aniversário hoje', () => {
    const [i] = planMessages(input({ patients: withPatient({ birthdate: '1990-11-03' }) }))
    expect(i).toMatchObject({ type: 'birthday', dedupe_key: 'birthday:p1:2026' })
    expect(i.scheduled_for).toEqual(new Date('2026-11-03T12:00:00Z'))
    expect(i.expires_at).toEqual(new Date('2026-11-03T23:00:00Z'))
  })
  it('usa a data no fuso da clínica', () => {
    const now = new Date('2026-11-04T01:00:00Z')
    expect(planMessages(input({ now, patients: withPatient({ birthdate: '1990-11-04' }) }))).toEqual([])
  })
  it('29/02 cai em 28/02 apenas em ano não bissexto', () => {
    const p = withPatient({ birthdate: '2000-02-29' })
    expect(planMessages(input({ now: new Date('2027-02-28T13:00:00Z'), patients: p }))).toHaveLength(1)
    expect(planMessages(input({ now: new Date('2028-02-28T13:00:00Z'), patients: p }))).toEqual([])
    expect(planMessages(input({ now: new Date('2028-02-29T13:00:00Z'), patients: p }))).toHaveLength(1)
  })
})

describe('planMessages - charge', () => {
  it('D+1 e D+7', () => {
    const a = planMessages(input({ payments: [pay({ due_date: '2026-11-02' })] }))
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ type: 'charge', dedupe_key: 'charge:pay1:1', payment_id: 'pay1', expires_at: null })
    expect(a[0].scheduled_for).toEqual(new Date('2026-11-03T11:00:00Z'))
    const b = planMessages(input({ payments: [pay({ due_date: '2026-10-27' })] }))
    expect(b[0].dedupe_key).toBe('charge:pay1:7')
  })
  it('usa o dia da clínica (22h SP do dia 03 ainda é dia 03)', () => {
    const now = new Date('2026-11-04T01:00:00Z')
    expect(planMessages(input({ now, payments: [pay({ due_date: '2026-11-03' })] }))).toEqual([])
  })
  it('outros dias, pago ou sem vencimento → nada', () => {
    expect(planMessages(input({ payments: [pay({ due_date: '2026-10-30' })] }))).toEqual([])
    expect(planMessages(input({ payments: [pay({ status: 'paid' })] }))).toEqual([])
    expect(planMessages(input({ payments: [pay({ due_date: null })] }))).toEqual([])
  })
})

describe('dedupeKey', () => {
  it('formata por tipo', () => {
    expect(dedupeKey('birthday', { patientId: 'p', year: 2026 })).toBe('birthday:p:2026')
    expect(dedupeKey('charge', { paymentId: 'x', offsetDays: 7 })).toBe('charge:x:7')
  })
})

describe('staleReason', () => {
  const key = 'confirmation:a1:2026-11-04T12:00:00.000Z'
  const item = { type: 'confirmation' as const, dedupe_key: key, expires_at: '2026-11-04T12:00:00.000Z' }
  const ok = { appointment: { start_time: '2026-11-04T12:00:00+00:00', status: 'scheduled' }, patient: { whatsapp_opt_out: false } }
  it('válido → null', () => expect(staleReason(item, NOW, ok)).toBeNull())
  it('remarcada', () => {
    expect(staleReason(item, NOW, { ...ok, appointment: { start_time: '2026-11-05T12:00:00Z', status: 'scheduled' } })).toBe('appointment_changed')
  })
  it('cancelada / no_show / ausente', () => {
    for (const status of ['cancelled', 'no_show'])
      expect(staleReason(item, NOW, { ...ok, appointment: { ...ok.appointment, status } })).toBe('appointment_changed')
    expect(staleReason(item, NOW, { ...ok, appointment: null })).toBe('appointment_changed')
  })
  it('reminder não confirmado', () => {
    const r = { ...item, type: 'reminder' as const, dedupe_key: 'reminder:a1:2026-11-04T12:00:00.000Z' }
    expect(staleReason(r, NOW, ok)).toBe('not_confirmed')
    expect(staleReason(r, NOW, { ...ok, appointment: { ...ok.appointment, status: 'confirmed' } })).toBeNull()
  })
  it('charge pago', () => {
    const c = { type: 'charge' as const, dedupe_key: 'charge:pay1:1', expires_at: null }
    expect(staleReason(c, NOW, { payment: { status: 'paid' } })).toBe('paid')
    expect(staleReason(c, NOW, { payment: { status: 'pending' } })).toBeNull()
  })
  it('opt-out e expirado', () => {
    expect(staleReason(item, NOW, { ...ok, patient: { whatsapp_opt_out: true } })).toBe('opt_out')
    expect(staleReason({ ...item, expires_at: '2026-11-03T12:00:00Z' }, NOW, ok)).toBe('expired')
  })
  it('tipos sem regra → null', () => {
    expect(staleReason({ type: 'manual', dedupe_key: null, expires_at: null }, NOW, {})).toBeNull()
  })
})
