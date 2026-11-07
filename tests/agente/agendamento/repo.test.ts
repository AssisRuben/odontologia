import { describe, it, expect, vi } from 'vitest'
import { fakeAdmin } from '../../fakeSupabase'
import { createAgendaDeps } from '@/lib/agente/agendamento/repo'

const from = new Date('2026-11-06T17:00:00Z')
const to = new Date('2026-12-07T17:00:00Z')

describe('createAgendaDeps', () => {
  it('carregar não inclui cancelled/no_show e normaliza horários', async () => {
    const { admin, queries } = fakeAdmin((q) => {
      if (q.table === 'professionals') {
        return {
          data: [
            { id: 'p1', name: 'Dr. Carlos', working_hours: { '1': [['08:00', '12:00']], x: 1 }, whatsapp_booking: true },
            { id: 'p2', name: 'Dra. Ana', working_hours: 'antigo', whatsapp_booking: false },
          ],
          error: null,
        }
      }
      return { data: [{ professional_id: 'p1', start_time: '2026-11-10T11:00:00Z', end_time: '2026-11-10T11:30:00Z' }], error: null }
    })
    const r = await createAgendaDeps(admin).carregar('k1', from, to)
    expect(r.profissionais).toEqual([
      { id: 'p1', nome: 'Dr. Carlos', workingHours: { '1': [['08:00', '12:00']] }, whatsappBooking: true },
      { id: 'p2', nome: 'Dra. Ana', workingHours: {}, whatsappBooking: false },
    ])
    expect(r.ocupados).toEqual([{ professional_id: 'p1', start: '2026-11-10T11:00:00Z', end: '2026-11-10T11:30:00Z' }])

    const prof = queries.find((q) => q.table === 'professionals')!
    expect(prof.calls).toContainEqual(['eq', 'clinic_id', 'k1'])
    const ap = queries.find((q) => q.table === 'appointments')!
    expect(ap.calls).toContainEqual(['eq', 'clinic_id', 'k1'])
    expect(ap.calls).toContainEqual(['not', 'status', 'in', '(cancelled,no_show)'])
    expect(ap.calls).toContainEqual(['lt', 'start_time', to.toISOString()])
    expect(ap.calls).toContainEqual(['gt', 'end_time', from.toISOString()])
  })

  it('gravar chama a RPC e devolve o id', async () => {
    const rpc = vi.fn(async () => ({ data: 'ap9', error: null }))
    const deps = createAgendaDeps({ rpc } as never)
    const r = await deps.gravar({
      clinicId: 'k1', patientId: 'pa', professionalId: 'p1',
      start: '2026-11-10T11:00:00Z', end: '2026-11-10T11:30:00Z', procedure: 'Avaliação', replaceId: null,
    })
    expect(r).toEqual({ ok: true, id: 'ap9' })
    expect(rpc).toHaveBeenCalledWith('book_whatsapp_appointment', {
      p_clinic_id: 'k1', p_patient_id: 'pa', p_professional_id: 'p1',
      p_start: '2026-11-10T11:00:00Z', p_end: '2026-11-10T11:30:00Z', p_procedure: 'Avaliação', p_replace_id: null,
    })
  })

  it('gravar mapeia P0001', async () => {
    const args = { clinicId: 'k1', patientId: 'pa', professionalId: 'p1', start: 's', end: 'e', procedure: 'X', replaceId: 'old' }
    const ocupado = createAgendaDeps({ rpc: async () => ({ data: null, error: { code: 'P0001', message: 'HORARIO_OCUPADO' } }) } as never)
    expect(await ocupado.gravar(args)).toEqual({ ok: false, erro: 'HORARIO_OCUPADO' })
    const invalida = createAgendaDeps({ rpc: async () => ({ data: null, error: { code: 'P0001', message: 'CONSULTA_INVALIDA' } }) } as never)
    expect(await invalida.gravar(args)).toEqual({ ok: false, erro: 'CONSULTA_INVALIDA' })
    const outro = createAgendaDeps({ rpc: async () => ({ data: null, error: { code: '42501', message: 'denied' } }) } as never)
    await expect(outro.gravar(args)).rejects.toThrow('denied')
  })

  it('desmarcar filtra clínica, paciente e status ativo', async () => {
    const { admin, queries } = fakeAdmin(() => ({ data: [{ id: 'ap1' }], error: null }))
    expect(await createAgendaDeps(admin).desmarcar('k1', 'pa', 'ap1')).toBe(true)
    const q = queries[0]
    expect(q.table).toBe('appointments')
    expect(q.calls).toContainEqual(['update', { status: 'cancelled' }])
    expect(q.calls).toContainEqual(['eq', 'id', 'ap1'])
    expect(q.calls).toContainEqual(['eq', 'clinic_id', 'k1'])
    expect(q.calls).toContainEqual(['eq', 'patient_id', 'pa'])
    expect(q.calls).toContainEqual(['in', 'status', ['scheduled', 'confirmed']])
  })

  it('desmarcar sem linha afetada devolve false', async () => {
    const { admin } = fakeAdmin(() => ({ data: [], error: null }))
    expect(await createAgendaDeps(admin).desmarcar('k1', 'pa', 'ap1')).toBe(false)
  })

  it('criarPaciente grava source whatsapp, phone e whatsapp', async () => {
    const { admin, queries } = fakeAdmin(() => ({ data: { id: 'pn' }, error: null }))
    expect(await createAgendaDeps(admin).criarPaciente('k1', 'Maria Souza', '5511')).toBe('pn')
    expect(queries[0].table).toBe('patients')
    expect(queries[0].calls).toContainEqual(['insert', { clinic_id: 'k1', name: 'Maria Souza', phone: '5511', whatsapp: '5511', source: 'whatsapp' }])
  })

  it('contarFuturasWhatsapp conta futuras ativas com source whatsapp', async () => {
    const { admin, queries } = fakeAdmin(() => ({ count: 2, error: null }))
    expect(await createAgendaDeps(admin).contarFuturasWhatsapp('k1', 'pa', from)).toBe(2)
    const c = queries[0].calls
    expect(c).toContainEqual(['eq', 'source', 'whatsapp'])
    expect(c).toContainEqual(['eq', 'patient_id', 'pa'])
    expect(c).toContainEqual(['gt', 'start_time', from.toISOString()])
    expect(c).toContainEqual(['in', 'status', ['scheduled', 'confirmed']])
  })

  it('salvarEstado e ligarPaciente atualizam a conversa', async () => {
    const { admin, queries } = fakeAdmin(() => ({ error: null }))
    const deps = createAgendaDeps(admin)
    await deps.salvarEstado('k1', 'c1', { offers: [], booking_draft: null, searches: ['t'] })
    await deps.ligarPaciente('k1', 'c1', 'pa')
    expect(queries[0].calls).toContainEqual(['update', { offers: [], booking_draft: null, searches: ['t'] }])
    expect(queries[0].calls).toContainEqual(['eq', 'id', 'c1'])
    expect(queries[0].calls).toContainEqual(['eq', 'clinic_id', 'k1'])
    expect(queries[1].calls).toContainEqual(['update', { patient_id: 'pa' }])
    expect(queries[1].calls).toContainEqual(['eq', 'id', 'c1'])
    expect(queries[1].calls).toContainEqual(['eq', 'clinic_id', 'k1'])
    expect(queries[1].calls).toContainEqual(['is', 'patient_id', null])
  })
})
