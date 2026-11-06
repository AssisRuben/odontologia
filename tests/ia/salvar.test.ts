import { describe, it, expect, vi } from 'vitest'
import { parseSalvarEvolucao, salvarEvolucao } from '@/lib/ia/evolucao/salvar'

const P = '11111111-1111-4111-8111-111111111111'
const I = '22222222-2222-4222-8222-222222222222'
const base = { patientId: P, date: '2026-11-06', description: 'Resina no 16.' }

describe('parseSalvarEvolucao', () => {
  it('aceita corpo mínimo', () => {
    expect(parseSalvarEvolucao(base)).toEqual({
      ok: true,
      input: { patientId: P, appointmentId: null, professionalId: null, date: '2026-11-06', description: 'Resina no 16.', images: [], aiUsed: false, acoes: [] },
    })
  })
  it('UUID inválido -> 422', () => {
    expect(parseSalvarEvolucao({ ...base, patientId: 'x' })).toMatchObject({ ok: false, status: 422 })
    expect(parseSalvarEvolucao({ ...base, appointmentId: 'x' })).toMatchObject({ ok: false, status: 422 })
  })
  it('data inválida -> 422', () => {
    expect(parseSalvarEvolucao({ ...base, date: '2026-02-31' })).toMatchObject({ ok: false, status: 422 })
  })
  it('descrição só com espaços ou longa demais -> 422', () => {
    expect(parseSalvarEvolucao({ ...base, description: '   ' })).toMatchObject({ ok: false, status: 422 })
    expect(parseSalvarEvolucao({ ...base, description: 'a'.repeat(20001) })).toMatchObject({ ok: false, status: 422 })
  })
  it('dente 19 -> 422 Sugestão inválida', () => {
    const r = parseSalvarEvolucao({
      ...base,
      acoes: [{ tipo: 'tratamento_novo', procedimento: 'Resina', dentes: [19], faces: [], status: 'completed' }],
    })
    expect(r).toEqual({ ok: false, status: 422, error: 'Sugestão inválida' })
  })
  it('retorno sai das ações e demais passam', () => {
    const r = parseSalvarEvolucao({
      ...base,
      aiUsed: true,
      acoes: [
        { tipo: 'retorno', dias: 7, motivo: 'revisão' },
        { tipo: 'item_orcamento', id: I, novo_status: 'completed' },
        { tipo: 'tratamento_novo', procedimento: ' Resina ', dentes: [16], faces: ['o', 'D'], status: 'completed' },
      ],
    })
    expect(r).toMatchObject({ ok: true })
    if (r.ok) {
      expect(r.input.aiUsed).toBe(true)
      expect(r.input.acoes).toEqual([
        { tipo: 'item_orcamento', id: I, novo_status: 'completed' },
        { tipo: 'tratamento_novo', procedimento: 'Resina', dentes: [16], faces: ['O', 'D'], status: 'completed' },
      ])
    }
  })
  it('tratamento_novo sem dentes zera as faces', () => {
    const r = parseSalvarEvolucao({
      ...base,
      acoes: [{ tipo: 'tratamento_novo', procedimento: 'Limpeza', dentes: [], faces: ['V'], status: 'planned' }],
    })
    if (r.ok) expect(r.input.acoes[0]).toMatchObject({ faces: [] })
    else throw new Error('esperava ok')
  })
  it('ação com id inválido ou status desconhecido -> 422', () => {
    expect(parseSalvarEvolucao({ ...base, acoes: [{ tipo: 'tratamento', id: 'x', novo_status: 'completed' }] })).toMatchObject({ ok: false, error: 'Sugestão inválida' })
    expect(parseSalvarEvolucao({ ...base, acoes: [{ tipo: 'tratamento', id: I, novo_status: 'pending' }] })).toMatchObject({ ok: false })
  })
})

describe('salvarEvolucao', () => {
  const input = {
    patientId: P, appointmentId: null, professionalId: null, date: '2026-11-06',
    description: 'x', images: [], aiUsed: true,
    acoes: [{ tipo: 'item_orcamento' as const, id: I, novo_status: 'completed' as const }],
  }
  it('sucesso devolve o id e chama o rpc com os nomes certos', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'abc', error: null })
    expect(await salvarEvolucao('C', input, { rpc })).toEqual({ status: 200, body: { id: 'abc' } })
    expect(rpc).toHaveBeenCalledWith({
      p_clinic_id: 'C', p_patient_id: P, p_appointment_id: null, p_professional_id: null,
      p_date: '2026-11-06', p_description: 'x', p_images: [], p_ai_used: true, p_actions: input.acoes,
    })
  })
  it('erro do banco vira 409 com a mensagem', async () => {
    const message = 'O item Canal já foi concluído ou mudou. Organize de novo.'
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'P0001', message } })
    expect(await salvarEvolucao('C', input, { rpc })).toEqual({ status: 409, body: { error: message } })
  })
  it('outro erro lança sem expor o texto', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '23505', message: 'segredo' } })
    await expect(salvarEvolucao('C', input, { rpc })).rejects.toThrow('23505')
    await expect(salvarEvolucao('C', input, { rpc })).rejects.not.toThrow('segredo')
  })
})
