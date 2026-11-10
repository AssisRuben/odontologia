import { describe, expect, it } from 'vitest'
import { aConfirmarHoje } from '@/lib/agenda/aguardando'
import type { Appointment } from '@/types'

const TZ = 'America/Sao_Paulo'
const apt = (id: string, start: string, status = 'scheduled', professional_id = 'p1') =>
  ({ id, start_time: start, status, professional_id }) as unknown as Appointment

describe('aConfirmarHoje', () => {
  const hoje = '2026-11-07'
  const agora = new Date('2026-11-07T13:30:00Z') // 10:30 em São Paulo

  it('lista só as consultas agendadas de hoje que ainda não passaram', () => {
    const lista = aConfirmarHoje([
      apt('tarde', '2026-11-07T18:00:00Z'),
      apt('ja-passou', '2026-11-07T12:00:00Z'),
      apt('confirmada', '2026-11-07T15:00:00Z', 'confirmed'),
      apt('amanha', '2026-11-08T13:00:00Z'),
      // 01:30 de 08/11 em UTC ainda é 07/11 em São Paulo
      apt('noite', '2026-11-08T01:30:00Z'),
      apt('cedo', '2026-11-07T14:00:00Z'),
    ], hoje, TZ, agora)
    expect(lista.map((a) => a.id)).toEqual(['cedo', 'tarde', 'noite'])
  })

  it('respeita o profissional selecionado', () => {
    const lista = aConfirmarHoje([
      apt('p1', '2026-11-07T18:00:00Z', 'scheduled', 'p1'),
      apt('p2', '2026-11-07T17:00:00Z', 'scheduled', 'p2'),
    ], hoje, TZ, agora, 'p2')
    expect(lista.map((a) => a.id)).toEqual(['p2'])
  })
})
