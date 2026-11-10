import { describe, it, expect } from 'vitest'
import { parseProtese, parseMover, parseLaboratorio, parseLaboratorioParcial } from '@/lib/protese/validar'
import { parseReaisInput } from '@/lib/payments/money'

const UUID = '123e4567-e89b-42d3-a456-426614174000'

describe('parseProtese', () => {
  it('só com paciente: resto null', () => {
    expect(parseProtese({ patientId: UUID })).toEqual({
      ok: true,
      input: { patientId: UUID, professionalId: null, laboratoryId: null, type: null, toothRegion: null, expectedAt: null, labCostCents: null, notes: null },
    })
  })
  it('sem paciente', () => {
    expect(parseProtese({})).toEqual({ ok: false, error: 'Escolha o paciente' })
    expect(parseProtese({ patientId: '' })).toEqual({ ok: false, error: 'Escolha o paciente' })
    expect(parseProtese(null)).toEqual({ ok: false, error: 'Dados inválidos' })
  })
  it('custo em centavos', () => {
    const ok = (labCostCents: unknown) => parseProtese({ patientId: UUID, labCostCents })
    expect(ok(35050)).toMatchObject({ ok: true, input: { labCostCents: 35050 } })
    expect(ok(123456)).toMatchObject({ ok: true, input: { labCostCents: 123456 } })
    expect(ok(0)).toMatchObject({ ok: true, input: { labCostCents: 0 } })
    expect(ok(null)).toMatchObject({ ok: true, input: { labCostCents: null } })
    expect(ok(9999999999)).toMatchObject({ ok: true, input: { labCostCents: 9999999999 } })
    expect(ok(10000000000)).toEqual({ ok: false, error: 'Custo inválido' })
    for (const bad of [-1, 1.5, '350', NaN]) expect(ok(bad)).toEqual({ ok: false, error: 'Custo inválido' })
  })
  it('data, tamanhos e ids', () => {
    expect(parseProtese({ patientId: UUID, expectedAt: '2026-02-30' })).toEqual({ ok: false, error: 'Data inválida' })
    expect(parseProtese({ patientId: UUID, expectedAt: '2026-11-20' })).toMatchObject({ ok: true, input: { expectedAt: '2026-11-20' } })
    expect(parseProtese({ patientId: UUID, type: 'a'.repeat(81) })).toEqual({ ok: false, error: 'Tipo muito longo' })
    expect(parseProtese({ patientId: UUID, type: 'a'.repeat(80) }).ok).toBe(true)
    expect(parseProtese({ patientId: UUID, professionalId: 'x' })).toEqual({ ok: false, error: 'Dados inválidos' })
    expect(parseProtese({ patientId: UUID, laboratoryId: 'x' })).toEqual({ ok: false, error: 'Dados inválidos' })
  })
  it('dente/região até 40 e observações até 1000', () => {
    expect(parseProtese({ patientId: UUID, toothRegion: 'a'.repeat(40) }).ok).toBe(true)
    expect(parseProtese({ patientId: UUID, toothRegion: 'a'.repeat(41) })).toEqual({ ok: false, error: 'Dente/região muito longo' })
    expect(parseProtese({ patientId: UUID, notes: 'a'.repeat(1000) }).ok).toBe(true)
    expect(parseProtese({ patientId: UUID, notes: 'a'.repeat(1001) })).toEqual({ ok: false, error: 'Observações muito longas' })
  })
  it('strings vazias ou com espaços viram null; texto é aparado', () => {
    const r = parseProtese({ patientId: UUID, professionalId: '', laboratoryId: '  ', type: '   ', toothRegion: '', expectedAt: '', notes: ' ' })
    expect(r).toMatchObject({ ok: true, input: { professionalId: null, laboratoryId: null, type: null, toothRegion: null, expectedAt: null, notes: null } })
    expect(parseProtese({ patientId: UUID, type: ' Coroa ' })).toMatchObject({ input: { type: 'Coroa' } })
  })
})

describe('entrada de custo na tela (parseReaisInput para centavos)', () => {
  it('vírgula, milhar e R$', () => {
    expect(parseReaisInput('1.234,56')).toBe(123456)
    expect(parseReaisInput('350,50')).toBe(35050)
    expect(parseReaisInput('R$ 80')).toBe(8000)
    expect(parseReaisInput('abc')).toBeNull()
  })
})

describe('parseMover', () => {
  it('etapas', () => {
    expect(parseMover({ de: 'requested', para: 'requested' })).toEqual({ ok: false, error: 'Escolha outra etapa' })
    expect(parseMover({ de: 'requested', para: 'foo' })).toEqual({ ok: false, error: 'Dados inválidos' })
    expect(parseMover({ de: 'foo', para: 'requested' })).toEqual({ ok: false, error: 'Dados inválidos' })
    expect(parseMover({ de: 'requested', para: 'sent_to_lab' })).toEqual({ ok: true, input: { de: 'requested', para: 'sent_to_lab', observacao: null, previsao: null } })
  })
  it('observação e previsão', () => {
    expect(parseMover({ de: 'requested', para: 'sent_to_lab', observacao: 'a'.repeat(301) })).toEqual({ ok: false, error: 'Observação muito longa' })
    expect(parseMover({ de: 'requested', para: 'sent_to_lab', observacao: ' ok ' })).toMatchObject({ input: { observacao: 'ok' } })
    expect(parseMover({ de: 'requested', para: 'sent_to_lab', previsao: '2026-13-01' })).toEqual({ ok: false, error: 'Data inválida' })
    expect(parseMover({ de: 'requested', para: 'sent_to_lab', previsao: '2026-11-20' })).toMatchObject({ input: { previsao: '2026-11-20' } })
  })
})

describe('parseLaboratorio', () => {
  it('nome aparado e limites', () => {
    expect(parseLaboratorio({ name: '  Lab X ' })).toEqual({ ok: true, input: { name: 'Lab X', phone: null, notes: null } })
    expect(parseLaboratorio({ name: '   ' })).toEqual({ ok: false, error: 'Informe o nome' })
    expect(parseLaboratorio({})).toEqual({ ok: false, error: 'Informe o nome' })
    expect(parseLaboratorio({ name: 'a'.repeat(81) })).toEqual({ ok: false, error: 'Nome muito longo' })
    expect(parseLaboratorio({ name: 'Lab', phone: '1'.repeat(31) })).toEqual({ ok: false, error: 'Telefone muito longo' })
    expect(parseLaboratorio(5)).toEqual({ ok: false, error: 'Dados inválidos' })
  })
  it('active só se boolean', () => {
    expect(parseLaboratorio({ name: 'Lab', active: false })).toMatchObject({ input: { active: false } })
    expect(parseLaboratorio({ name: 'Lab', active: 'x' })).toEqual({ ok: true, input: { name: 'Lab', phone: null, notes: null } })
  })
})

describe('parseLaboratorioParcial', () => {
  it('só active', () => {
    expect(parseLaboratorioParcial({ active: false })).toEqual({ ok: true, input: { active: false } })
  })
  it('só os campos enviados, com trim e vazio virando null', () => {
    expect(parseLaboratorioParcial({ name: ' Lab X ', phone: ' ' })).toEqual({ ok: true, input: { name: 'Lab X', phone: null } })
  })
  it('objeto vazio ou sem campos conhecidos', () => {
    expect(parseLaboratorioParcial({})).toEqual({ ok: false, error: 'Dados inválidos' })
    expect(parseLaboratorioParcial({ foo: 1 })).toEqual({ ok: false, error: 'Dados inválidos' })
    expect(parseLaboratorioParcial(null)).toEqual({ ok: false, error: 'Dados inválidos' })
  })
  it('regras por campo', () => {
    expect(parseLaboratorioParcial({ name: '  ' })).toEqual({ ok: false, error: 'Informe o nome' })
    expect(parseLaboratorioParcial({ name: 'a'.repeat(81) })).toEqual({ ok: false, error: 'Nome muito longo' })
    expect(parseLaboratorioParcial({ phone: 'x'.repeat(31) })).toEqual({ ok: false, error: 'Telefone muito longo' })
    expect(parseLaboratorioParcial({ notes: 'x'.repeat(501) })).toEqual({ ok: false, error: 'Observações muito longas' })
    expect(parseLaboratorioParcial({ active: 'sim' })).toEqual({ ok: false, error: 'Dados inválidos' })
  })
})
