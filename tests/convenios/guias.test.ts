import { describe, it, expect } from 'vitest'
import {
  validarCriacaoGuia, montarItens, statusInicial, validarResposta, type TratamentoParaGuia,
} from '@/lib/convenios/guias'

const trat = (id: string, o: Partial<TratamentoParaGuia> = {}): TratamentoParaGuia => ({
  id, patient_id: 'p1', insurance_plan_id: 'c1', status: 'planned', value: 80,
  teeth: [{ tooth: 11, faces: ['V'] }],
  procedimento: { code: '81000049', name: 'Restauração', requires_authorization: false },
  emGuiaAtiva: false, ...o,
})
const input = (ids: string[]) => ({ patientId: 'p1', insurancePlanId: 'c1', treatmentIds: ids })

describe('validarCriacaoGuia', () => {
  it('ok', () => {
    expect(validarCriacaoGuia(input(['a']), [trat('a')])).toEqual({ ok: true })
  })
  it('lista vazia', () => {
    expect(validarCriacaoGuia(input([]), [])).toEqual({ ok: false, error: 'Escolha ao menos um tratamento' })
  })
  it('mais de 30', () => {
    const ids = Array.from({ length: 31 }, (_, i) => `t${i}`)
    expect(validarCriacaoGuia(input(ids), ids.map((i) => trat(i)))).toEqual({ ok: false, error: 'Máximo de 30 itens por guia' })
  })
  it('id sem tratamento', () => {
    expect(validarCriacaoGuia(input(['a', 'b']), [trat('a')])).toEqual({ ok: false, error: 'Tratamento não encontrado' })
  })
  it('outro paciente ou convênio', () => {
    expect(validarCriacaoGuia(input(['a']), [trat('a', { patient_id: 'p2' })]).ok).toBe(false)
    expect(validarCriacaoGuia(input(['a']), [trat('a', { insurance_plan_id: 'c2' })])).toEqual({
      ok: false, error: 'Tratamento de outro paciente ou convênio',
    })
  })
  it('fora da tabela recusa', () => {
    expect(validarCriacaoGuia(input(['a']), [trat('a', { procedimento: null })])).toEqual({
      ok: false, error: 'Tratamento fora da tabela do convênio',
    })
  })
  it('cancelado', () => {
    expect(validarCriacaoGuia(input(['a']), [trat('a', { status: 'cancelled' })])).toEqual({ ok: false, error: 'Tratamento cancelado' })
  })
  it('já em guia ativa', () => {
    expect(validarCriacaoGuia(input(['a']), [trat('a', { emGuiaAtiva: true })])).toEqual({
      ok: false, error: 'Tratamento já está em outra guia',
    })
  })
  it('ordem dos erros: fora da tabela antes de cancelado', () => {
    expect(validarCriacaoGuia(input(['a']), [trat('a', { procedimento: null, status: 'cancelled', emGuiaAtiva: true })])).toEqual({
      ok: false, error: 'Tratamento fora da tabela do convênio',
    })
  })
})

describe('montarItens / statusInicial', () => {
  const exige = { code: '81000050', name: 'Canal', requires_authorization: true }
  it('copia value do tratamento; todos sem autorização → liberada', () => {
    const itens = montarItens([trat('a', { value: 95.5 })])
    expect(itens).toEqual([{
      treatment_id: 'a', code: '81000049', name: 'Restauração', teeth: [{ tooth: 11, faces: ['V'] }],
      value: 95.5, requires_authorization: false, authorization: 'nao_exige',
    }])
    expect(statusInicial(itens)).toBe('liberada')
  })
  it('um exige → aguardando', () => {
    const itens = montarItens([trat('a'), trat('b', { procedimento: exige })])
    expect(itens.map((i) => i.authorization)).toEqual(['nao_exige', 'pendente'])
    expect(statusInicial(itens)).toBe('aguardando')
  })
})

describe('validarResposta', () => {
  const itensGuia = [{ id: 'i1', requires_authorization: true }, { id: 'i2', requires_authorization: false }]
  const base = { guideNumber: ' 123 ', password: 'abc', passwordValidUntil: '2026-12-31', itens: [] as unknown[] }

  it('ok e normaliza', () => {
    const r = validarResposta({ ...base, itens: [{ id: 'i1', authorization: 'autorizado' }] }, itensGuia)
    expect(r).toEqual({
      ok: true,
      resposta: {
        guideNumber: '123', password: 'abc', passwordValidUntil: '2026-12-31',
        itens: [{ id: 'i1', authorization: 'autorizado', denialReason: null }],
      },
    })
  })
  it('campos vazios viram null', () => {
    const r = validarResposta({ guideNumber: '', itens: [] }, itensGuia)
    expect(r).toEqual({ ok: true, resposta: { guideNumber: null, password: null, passwordValidUntil: null, itens: [] } })
  })
  it('id estranho', () => {
    expect(validarResposta({ ...base, itens: [{ id: 'x', authorization: 'autorizado' }] }, itensGuia)).toEqual({
      ok: false, error: 'Item não pertence à guia',
    })
  })
  it('item que não exige', () => {
    expect(validarResposta({ ...base, itens: [{ id: 'i2', authorization: 'autorizado' }] }, itensGuia)).toEqual({
      ok: false, error: 'Item não exige autorização',
    })
  })
  it('negado sem motivo', () => {
    expect(validarResposta({ ...base, itens: [{ id: 'i1', authorization: 'negado', denialReason: '  ' }] }, itensGuia)).toEqual({
      ok: false, error: 'Informe o motivo da negativa',
    })
  })
  it('negado com motivo mantém; autorizado descarta motivo', () => {
    const r = validarResposta({ ...base, itens: [{ id: 'i1', authorization: 'negado', denialReason: 'Sem cobertura' }] }, itensGuia)
    expect(r.ok && r.resposta.itens[0]).toEqual({ id: 'i1', authorization: 'negado', denialReason: 'Sem cobertura' })
    const r2 = validarResposta({ ...base, itens: [{ id: 'i1', authorization: 'autorizado', denialReason: 'x' }] }, itensGuia)
    expect(r2.ok && r2.resposta.itens[0].denialReason).toBeNull()
  })
  it('limites e data', () => {
    expect(validarResposta({ ...base, guideNumber: 'a'.repeat(41) }, itensGuia)).toEqual({ ok: false, error: 'Número da guia muito longo' })
    expect(validarResposta({ ...base, password: 'a'.repeat(41) }, itensGuia)).toEqual({ ok: false, error: 'Senha muito longa' })
    expect(validarResposta({ ...base, passwordValidUntil: '2026-02-30' }, itensGuia)).toEqual({ ok: false, error: 'Data inválida' })
    expect(validarResposta({ ...base, itens: [{ id: 'i1', authorization: 'negado', denialReason: 'a'.repeat(201) }] }, itensGuia)).toEqual({
      ok: false, error: 'Motivo muito longo',
    })
  })
  it('entrada inválida', () => {
    expect(validarResposta(null, itensGuia).ok).toBe(false)
    expect(validarResposta({ ...base, itens: [{ id: 'i1', authorization: 'pendente' }] }, itensGuia).ok).toBe(false)
  })
})
