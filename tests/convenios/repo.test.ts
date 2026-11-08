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

  it('atribuir e enviarLote chamam as RPCs; erro vira { code, message }', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 3, error: null })
    const { repo } = repoCom(() => ({ data: null, error: null }), rpc)
    expect(await repo.atribuir('c1', 'b1', ['i1'])).toBe(3)
    expect(rpc).toHaveBeenCalledWith('assign_batch_items', { p_clinic_id: 'c1', p_batch_id: 'b1', p_item_ids: ['i1'] })
    await repo.enviarLote('c1', 'b1', 'P', '2026-11-07')
    expect(rpc).toHaveBeenCalledWith('send_insurance_batch', { p_clinic_id: 'c1', p_batch_id: 'b1', p_protocol: 'P', p_sent_at: '2026-11-07' })
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'LOTE_ENVIADO', details: 'x', hint: 'y' } })
    await expect(repo.enviarLote('c1', 'b1', 'P', '2026-11-07')).rejects.toEqual({ code: 'P0001', message: 'LOTE_ENVIADO' })
  })

  it('criarLotes faz upsert ignorando duplicados e não consulta sem períodos', async () => {
    const { repo, queries } = repoCom(() => ({ data: null, error: null }))
    await repo.criarLotes('c1', 'pl', [])
    expect(queries).toHaveLength(0)
    await repo.criarLotes('c1', 'pl', [{ period_start: '2026-10-16', period_end: '2026-11-15', due_date: '2026-11-25' }])
    expect(queries[0].calls[0]).toEqual([
      'upsert',
      [{ clinic_id: 'c1', insurance_plan_id: 'pl', period_start: '2026-10-16', period_end: '2026-11-15', due_date: '2026-11-25' }],
      { onConflict: 'insurance_plan_id,period_end', ignoreDuplicates: true },
    ])
  })

  it('marcarDigitado só atualiza item do lote aberto', async () => {
    const { repo, queries } = repoCom((q) =>
      q.table === 'insurance_batches' ? { data: { status: 'aberto' }, error: null } : { data: [{ id: 'i1' }], error: null },
    )
    expect(await repo.marcarDigitado('c1', 'b1', 'i1', true)).toBe(true)
    expect(queries[1].calls).toContainEqual(['eq', 'batch_id', 'b1'])
    expect(queries[1].calls).toContainEqual(['eq', 'clinic_id', 'c1'])
    const enviado = repoCom(() => ({ data: { status: 'enviado' }, error: null }))
    await expect(enviado.repo.marcarDigitado('c1', 'b1', 'i1', true)).rejects.toMatchObject({ message: 'LOTE_ENVIADO' })
    expect(enviado.queries).toHaveLength(1)
    const pago = repoCom(() => ({ data: { status: 'pago' }, error: null }))
    await expect(pago.repo.marcarDigitado('c1', 'b1', 'i1', true)).rejects.toMatchObject({ message: 'LOTE_ENVIADO' })
  })

  it('itensSemLote pede a segunda página quando a primeira vem com 1000 linhas', async () => {
    const linha = (n: number) => ({
      id: `i${n}`, guide_id: 'g', active: true, authorization: 'autorizado', batch_id: null, executed_at: null, defer_until: null,
      guide: { insurance_plan_id: 'pl' }, treatment: null,
    })
    const { repo, queries } = repoCom((q) => {
      const r = q.calls.find((c) => c[0] === 'range') as [string, number, number]
      return { data: r[1] === 0 ? Array.from({ length: 1000 }, (_, n) => linha(n)) : [linha(1000)], error: null }
    })
    const r = await repo.itensSemLote('c1')
    expect(r).toHaveLength(1001)
    expect(queries.map((q) => q.calls.find((c) => c[0] === 'range'))).toEqual([['range', 0, 999], ['range', 1000, 1999]])
    expect(queries[0].calls).toContainEqual(['order', 'id'])
  })

  it('lotesComItens pagina os itens e usa o corte de 6 meses sem estourar o fim do mês', async () => {
    const lote = { id: 'b1', insurance_plan_id: 'pl', period_start: '2026-10-16', period_end: '2026-11-15', due_date: '2026-11-25', status: 'aberto', plan: { id: 'pl', name: 'Amil' } }
    const it = (n: number) => ({
      id: `i${n}`, batch_id: 'b1', code: '1', name: 'n', teeth: [], value: '1.10', typed: false, executed_at: '2026-10-20',
      guide: { patient_id: 'p', guide_number: null, password: null, insurance_card: null, patient: { name: 'Ana' } }, treatment: null,
    })
    const { repo, queries } = repoCom((q) => {
      if (q.table === 'insurance_batches') return { data: [lote], error: null }
      const r = q.calls.find((c) => c[0] === 'range') as [string, number, number]
      return { data: r[1] === 0 ? Array.from({ length: 1000 }, (_, n) => it(n)) : [it(1000)], error: null }
    })
    const r = await repo.lotesComItens('c1', '2026-08-31')
    expect(r[0].itens).toHaveLength(1001)
    expect(r[0].total).toBe(1101.1)
    expect(queries[0].calls).toContainEqual(['or', 'status.eq.aberto,and(status.in.(enviado,pago),period_end.gte.2026-02-28)'])
    expect(queries.filter((q) => q.table === 'insurance_guide_items')).toHaveLength(2)
  })

  it('dadosPendencias pagina os tratamentos concluídos', async () => {
    const t = (n: number) => ({
      id: `t${n}`, patient_id: 'p', procedure: 'x', insurance_plan_id: 'pl', insurance_procedure_id: null, patient: { name: 'Ana' }, proc: null,
    })
    const { repo, queries } = repoCom((q) => {
      if (q.table !== 'treatments') return { data: [], error: null }
      const r = q.calls.find((c) => c[0] === 'range') as [string, number, number]
      return { data: r[1] === 0 ? Array.from({ length: 1000 }, (_, n) => t(n)) : [t(1000)], error: null }
    })
    const r = await repo.dadosPendencias('c1')
    expect(r.tratamentos).toHaveLength(1001)
    expect(queries.filter((q) => q.table === 'treatments' && q.calls.some((c) => c[0] === 'range'))).toHaveLength(2)
  })

  it('dadosPendencias olha só os últimos 6 meses e operadoras sem fechamento ativas ou não', async () => {
    const { repo, queries } = repoCom((q) => {
      if (q.table === 'insurance_plans') return { data: [{ id: 'pl', name: 'Velha' }], error: null }
      if (q.table === 'treatments' && q.calls.some((c) => c[0] === 'limit')) return { data: [{ id: 't' }], error: null }
      if (q.table === 'treatments') {
        return {
          data: [
            { id: 't1', patient_id: 'p', procedure: 'Canal', insurance_plan_id: 'pl', insurance_procedure_id: 'pr', patient: { name: 'Ana' }, proc: { insurance_plan_id: 'pl', active: false } },
            { id: 't2', patient_id: 'p', procedure: 'Limpeza', insurance_plan_id: 'pl', insurance_procedure_id: 'pr', patient: { name: 'Ana' }, proc: { insurance_plan_id: 'pl', active: true } },
          ],
          error: null,
        }
      }
      return { data: [], error: null }
    })
    const r = await repo.dadosPendencias('c1', '2026-11-07')
    const trat = queries.find((q) => q.table === 'treatments' && q.calls.some((c) => c[0] === 'range'))!
    expect(trat.calls).toContainEqual(['gte', 'completed_at', '2026-05-07'])
    expect(trat.calls).toContainEqual(['eq', 'status', 'completed'])
    expect(r.tratamentos.map((t) => [t.id, t.situacao])).toEqual([['t1', 'fora_tabela'], ['t2', 'sem_guia']])
    const planos = queries.find((q) => q.table === 'insurance_plans')!
    expect(planos.calls).toContainEqual(['is', 'closing_day', null])
    expect(planos.calls.some((c) => c[0] === 'eq' && c[1] === 'active')).toBe(false)
    expect(r.operadorasSemFechamento).toEqual([{ id: 'pl', name: 'Velha' }])
  })

  it('dadosPendencias lê lotes enviados e glosas de lotes pagos, filtrando por clínica e paginando', async () => {
    const item = (n: number) => ({
      id: `i${n}`, batch_id: 'bp', glosa_code: '1801', appeal_status: 'nenhum', appeal_result_at: null, recovered_payment_id: null,
      guide: { patient: { name: 'Ana' } },
    })
    const { repo, queries } = repoCom((q) => {
      const status = q.calls.find((c) => c[0] === 'eq' && c[1] === 'status')
      if (q.table === 'insurance_batches' && status?.[2] === 'enviado') {
        return { data: [
          { id: 'be', period_end: '2026-10-31', sent_at: '2026-10-05', plan: { name: 'Uniodonto', payment_days: 20 } },
          { id: 'sem', period_end: '2026-10-31', sent_at: null, plan: { name: 'X', payment_days: 20 } },
        ], error: null }
      }
      if (q.table === 'insurance_batches' && status?.[2] === 'pago') {
        return { data: [{ id: 'bp', paid_at: '2026-10-20', plan: { appeal_days: 15 } }], error: null }
      }
      if (q.table === 'insurance_guide_items' && q.calls.some((c) => c[0] === 'gt')) {
        const r = q.calls.find((c) => c[0] === 'range') as [string, number, number]
        return { data: r[1] === 0 ? Array.from({ length: 1000 }, (_, n) => item(n)) : [item(1000)], error: null }
      }
      return { data: [], error: null }
    })
    const r = await repo.dadosPendencias('c1', '2026-11-07')
    expect(r.lotesEnviados).toEqual([
      { id: 'be', plan_name: 'Uniodonto', period_end: '2026-10-31', sent_at: '2026-10-05', payment_days: 20 },
    ])
    expect(r.glosas).toHaveLength(1001)
    expect(r.glosas[0]).toEqual({
      item_id: 'i0', patient_name: 'Ana', glosa_code: '1801', paid_at: '2026-10-20', appeal_days: 15,
      appeal_status: 'nenhum', appeal_result_at: null, recovered_payment_id: null,
    })
    const pagos = queries.find((q) => q.table === 'insurance_batches' && q.calls.some((c) => c[0] === 'eq' && c[2] === 'pago'))!
    expect(pagos.calls).toContainEqual(['eq', 'clinic_id', 'c1'])
    expect(pagos.calls).toContainEqual(['gte', 'paid_at', '2026-05-07'])
    const itens = queries.filter((q) => q.table === 'insurance_guide_items' && q.calls.some((c) => c[0] === 'gt'))
    expect(itens).toHaveLength(2)
    expect(itens[0].calls).toContainEqual(['eq', 'clinic_id', 'c1'])
    expect(itens[0].calls).toContainEqual(['gt', 'glosa_value', 0])
    expect(itens[0].calls).toContainEqual(['in', 'batch_id', ['bp']])
  })

  it('itensSemLote traz só ativos fora de lote com a operadora da guia', async () => {
    const { repo, queries } = repoCom(() => ({
      data: [
        { id: 'i1', guide_id: 'g', active: true, authorization: 'autorizado', batch_id: null, executed_at: null, defer_until: null, guide: { insurance_plan_id: 'pl' }, treatment: null },
      ],
      error: null,
    }))
    const r = await repo.itensSemLote('c1')
    expect(r).toEqual([expect.objectContaining({ id: 'i1', plan_id: 'pl' })])
    expect(queries[0].calls).toContainEqual(['is', 'batch_id', null])
    expect(queries[0].calls).toContainEqual(['eq', 'clinic_id', 'c1'])
  })

  it('registrarPagamento traduz os itens para o formato da RPC e propaga o erro do banco', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 2, error: null })
    const { repo } = repoCom(() => ({ data: null, error: null }), rpc)
    await repo.registrarPagamento('c1', 'b1', {
      paidAt: '2026-11-07', deposit: 10, itens: [{ id: 'i1', paidValue: 10, glosaCode: null, glosaNote: null }],
    })
    expect(rpc).toHaveBeenCalledWith('register_batch_payment', {
      p_clinic_id: 'c1', p_batch_id: 'b1', p_paid_at: '2026-11-07', p_deposit: 10,
      p_items: [{ id: 'i1', paid_value: 10, glosa_code: null, glosa_note: null }],
    })
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'LOTE_NAO_ENVIADO', details: 'x' } })
    await expect(repo.desfazerPagamento('c1', 'b1')).rejects.toEqual({ code: 'P0001', message: 'LOTE_NAO_ENVIADO' })
  })

  it('buscarMotivos: prefixo para dígitos, nome para texto, mínimo 2 caracteres', async () => {
    const { repo, queries } = repoCom(() => ({ data: [{ code: '1705', name: 'x' }], error: null }))
    expect(await repo.buscarMotivos(' 1 ')).toEqual([])
    await repo.buscarMotivos('17')
    await repo.buscarMotivos('50%_')
    expect(queries).toHaveLength(2)
    expect(queries[0].calls).toContainEqual(['like', 'code', '17%'])
    expect(queries[1].calls).toContainEqual(['ilike', 'name', '%50  %'])
  })

  it('erroDoBanco: textos próprios da rota valem antes dos padrões', () => {
    expect(erroDoBanco({ code: '23503' })).toBeNull()
    expect(erroDoBanco({ message: 'VALOR_INVALIDO' })).toEqual({ status: 422, error: 'Valor pago inválido' })
    expect(erroDoBanco({ message: 'VALOR_INVALIDO' }, { VALOR_INVALIDO: { status: 422, error: 'Valor recuperado inválido' } }))
      .toEqual({ status: 422, error: 'Valor recuperado inválido' })
  })
})
