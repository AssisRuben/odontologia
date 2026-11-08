import { describe, expect, it } from 'vitest'
import { aguardandoHoje } from '@/lib/agenda/aguardando'
import type { Appointment } from '@/types'

const TZ = 'America/Sao_Paulo'
const apt = (id: string, start: string, status = 'waiting', professional_id = 'p1') =>
  ({ id, start_time: start, status, professional_id }) as unknown as Appointment

describe('aguardandoHoje', () => {
  const hoje = '2026-11-07'

  it('conta só quem está aguardando hoje, no fuso da clínica', () => {
    const lista = aguardandoHoje([
      apt('a', '2026-11-07T13:00:00Z'),
      apt('antiga', '2026-10-01T13:00:00Z'),
      apt('confirmada', '2026-11-07T14:00:00Z', 'confirmed'),
      // 01:30 de 08/11 em UTC ainda é 07/11 em São Paulo
      apt('noite', '2026-11-08T01:30:00Z'),
    ], hoje, TZ)
    expect(lista.map((a) => a.id)).toEqual(['a', 'noite'])
  })

  it('ordena por horário e respeita o profissional selecionado', () => {
    const lista = aguardandoHoje([
      apt('tarde', '2026-11-07T18:00:00Z', 'waiting', 'p1'),
      apt('outro', '2026-11-07T12:00:00Z', 'waiting', 'p2'),
      apt('manha', '2026-11-07T12:30:00Z', 'waiting', 'p1'),
    ], hoje, TZ, 'p1')
    expect(lista.map((a) => a.id)).toEqual(['manha', 'tarde'])
  })
})
