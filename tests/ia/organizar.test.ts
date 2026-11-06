import { describe, it, expect } from 'vitest'
import { parseOrganizar } from '@/lib/ia/evolucao/salvar'

const P = '11111111-1111-4111-8111-111111111111'

describe('parseOrganizar', () => {
  it('aceita paciente e texto', () => {
    expect(parseOrganizar({ patientId: P, texto: ' Resina no 16 ' })).toEqual({ ok: true, patientId: P, texto: 'Resina no 16' })
  })
  it('texto vazio ou de 20001 caracteres -> 422', () => {
    const e = { ok: false, status: 422, error: 'Texto vazio ou longo demais' }
    expect(parseOrganizar({ patientId: P, texto: '  ' })).toEqual(e)
    expect(parseOrganizar({ patientId: P, texto: 'a'.repeat(20001) })).toEqual(e)
    expect(parseOrganizar({ patientId: P, texto: 'a'.repeat(20000) })).toMatchObject({ ok: true })
  })
  it('paciente inválido -> 422', () => {
    expect(parseOrganizar({ patientId: 'x', texto: 'a' })).toMatchObject({ ok: false, status: 422 })
    expect(parseOrganizar(null)).toMatchObject({ ok: false, status: 422 })
  })
})
