import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fakeAdmin, type Query } from '../fakeSupabase'
import { createConveniosRepo } from '@/lib/convenios/repo'
import { erroDoBanco, parseEnvio, parseItemLote, parseCriarGuia, parseExecutado } from '@/lib/convenios/rotas'

describe('erroDoBanco', () => {
  it.each([
    ['GUIA_INVALIDA', 404, 'Guia não encontrada'],
    ['GUIA_CANCELADA', 409, 'Guia cancelada'],
    ['GUIA_EM_LOTE', 409, 'Guia com item em lote não pode ser alterada'],
    ['LOTE_INVALIDO', 404, 'Lote não encontrado'],
    ['LOTE_ENVIADO', 409, 'Lote já enviado'],
    ['LOTE_VAZIO', 409, 'Lote vazio'],
  ])('%s', (message, status, error) => {
    expect(erroDoBanco({ code: 'P0001', message })).toEqual({ status, error })
  })
  it('23505 e desconhecido', () => {
    expect(erroDoBanco({ code: '23505', message: 'duplicate key' })).toEqual({ status: 409, error: 'Tratamento já está em outra guia' })
    expect(erroDoBanco({ code: '42P01', message: 'boom' })).toBeNull()
  })
})

describe('parsers', () => {
  it('parseEnvio exige protocolo', () => {
    expect(parseEnvio({ protocol: ' ', sentAt: '2026-11-07' })).toEqual({ ok: false, error: 'Informe o protocolo' })
    expect(parseEnvio({ protocol: ' A1 ', sentAt: '2026-11-07' })).toEqual({ ok: true, protocol: 'A1', sentAt: '2026-11-07' })
    expect(parseEnvio({ protocol: 'x'.repeat(61), sentAt: '2026-11-07' }).ok).toBe(false)
    expect(parseEnvio({ protocol: 'A', sentAt: '2026-13-40' })).toEqual({ ok: false, error: 'Data inválida' })
  })
  it('parseItemLote', () => {
    expect(parseItemLote({ typed: true })).toEqual({ ok: true, acao: { typed: true } })
    expect(parseItemLote({ remover: true })).toEqual({ ok: true, acao: { remover: true } })
    expect(parseItemLote({}).ok).toBe(false)
  })
  it('parseCriarGuia e parseExecutado', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    expect(parseCriarGuia({ patientId: id, insurancePlanId: id, treatmentIds: [id, id] })).toEqual({
      ok: true,
      input: { patientId: id, insurancePlanId: id, professionalId: null, treatmentIds: [id] },
    })
    expect(parseCriarGuia({ patientId: 'x', insurancePlanId: id, treatmentIds: [] }).ok).toBe(false)
    expect(parseCriarGuia({ patientId: id, insurancePlanId: id, treatmentIds: [] })).toEqual({ ok: false, error: 'Escolha ao menos um tratamento' })
    const muitos = Array.from({ length: 31 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`)
    expect(parseCriarGuia({ patientId: id, insurancePlanId: id, treatmentIds: muitos })).toEqual({ ok: false, error: 'Máximo de 30 itens por guia' })
    expect(parseExecutado({ executedAt: '2026-11-07' }).ok).toBe(true)
    expect(parseExecutado({ executedAt: 'ontem' }).ok).toBe(false)
  })
})

function repoCom(resolve: (q: Query) => unknown, rpc = vi.fn().mockResolvedValue({ data: null, error: null })) {
  const { admin, queries } = fakeAdmin((q) => resolve(q))
  const repo = createConveniosRepo({ ...admin, rpc } as unknown as SupabaseClient)
  return { repo, queries, rpc }
}

describe('createConveniosRepo', () => {
  it('criarGuia chama a RPC com os itens', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'g1', error: null })
    const { repo } = repoCom(() => ({ data: null, error: null }), rpc)
    const itens = [
      { treatment_id: 't1', code: '1', name: 'N', teeth: [], value: 10, requires_authorization: false, authorization: 'nao_exige' as const },
    ]
    const id = await repo.criarGuia('c1', { patientId: 'p', planId: 'pl', professionalId: null, card: '9', status: 'liberada', itens })
    expect(id).toBe('g1')
    expect(rpc).toHaveBeenCalledWith('create_insurance_guide', {
      p_clinic_id: 'c1', p_patient_id: 'p', p_plan_id: 'pl', p_professional_id: null, p_card: '9', p_status: 'liberada', p_items: itens,
    })
  })

  it('erro de RPC é relançado como { code, message }', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'P0001', message: 'GUIA_CANCELADA', details: 'x' } })
    const { repo } = repoCom(() => ({ data: null, error: null }), rpc)
    await expect(repo.cancelarGuia('c1', 'g1')).rejects.toEqual({ code: 'P0001', message: 'GUIA_CANCELADA' })
  })

  it('tratamentosParaGuia filtra por clinic_id e marca guia ativa', async () => {
    const { repo, queries } = repoCom((q) =>
      q.table === 'treatments'
        ? {
            data: [
              {
                id: 't1', patient_id: 'p', insurance_plan_id: 'pl', status: 'completed', value: '50.00',
                treatment_teeth: [{ tooth_number: 11, faces: ['M'] }],
                insurance_plan_procedures: { code: '8100', name: 'Consulta', requires_authorization: true, active: true, insurance_plan_id: 'pl' },
              },
              { id: 't2', patient_id: 'p', insurance_plan_id: 'pl', status: 'planned', value: 5, treatment_teeth: [], insurance_plan_procedures: null },
            ],
            error: null,
          }
        : { data: [{ treatment_id: 't1' }], error: null },
    )
    const r = await repo.tratamentosParaGuia('c1', ['t1', 't2'])
    expect(r[0]).toMatchObject({ id: 't1', value: 50, teeth: [{ tooth: 11, faces: ['M'] }], emGuiaAtiva: true })
    expect(r[0].procedimento).toEqual({ code: '8100', name: 'Consulta', requires_authorization: true })
    expect(r[1]).toMatchObject({ procedimento: null, emGuiaAtiva: false })
    for (const q of queries) expect(q.calls).toContainEqual(['eq', 'clinic_id', 'c1'])
  })

  it('atualizarItem só atua em item sem lote e falha com ITEM_EM_LOTE', async () => {
    const { repo, queries } = repoCom(() => ({ data: [], error: null }))
    await expect(repo.atualizarItem('c1', 'i1', { code: 'a', name: 'b', teeth: [], value: 1 })).rejects.toMatchObject({ code: 'ITEM_EM_LOTE' })
    expect(queries[0].calls).toContainEqual(['is', 'batch_id', null])
  })

  it('corrigirExecucao devolve false sem linhas', async () => {
    const { repo } = repoCom(() => ({ data: [], error: null }))
    expect(await repo.corrigirExecucao('c1', 'i1', '2026-11-07')).toBe(false)
  })
})
