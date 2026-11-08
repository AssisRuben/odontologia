import { describe, expect, it } from 'vitest'
import {
  situacaoCarteirinha,
  validarCarteirinha,
  validarItemTabela,
  validarOperadora,
} from '@/lib/convenios/cadastro'

describe('validarOperadora', () => {
  it('aceita registro ANS de 6 dígitos e rejeita outros', () => {
    expect(validarOperadora({ ans_registry: '12345' })).toEqual({ ok: false, error: 'Registro ANS deve ter 6 dígitos' })
    expect(validarOperadora({ ans_registry: '12345a' })).toEqual({ ok: false, error: 'Registro ANS deve ter 6 dígitos' })
    const r = validarOperadora({ ans_registry: '123456' })
    expect(r.ok && r.dados.ans_registry).toBe('123456')
  })

  it('valida o dia de fechamento de 1 a 28', () => {
    const msg = { ok: false, error: 'Dia de fechamento deve ser de 1 a 28' }
    expect(validarOperadora({ closing_day: 29 })).toEqual(msg)
    expect(validarOperadora({ closing_day: 0 })).toEqual(msg)
    expect(validarOperadora({ closing_day: 1.5 })).toEqual(msg)
    const r = validarOperadora({ closing_day: 28 })
    expect(r.ok && r.dados.closing_day).toBe(28)
    const s = validarOperadora({ closing_day: '15' })
    expect(s.ok && s.dados.closing_day).toBe(15)
  })

  it('prazo de envio: padrão 10, faixa 0 a 90', () => {
    const r = validarOperadora({})
    expect(r.ok && r.dados.submission_days).toBe(10)
    expect(validarOperadora({ submission_days: 91 })).toEqual({ ok: false, error: 'Prazo de envio deve ser de 0 a 90 dias' })
    expect(validarOperadora({ submission_days: -1 })).toEqual({ ok: false, error: 'Prazo de envio deve ser de 0 a 90 dias' })
    const z = validarOperadora({ submission_days: 0 })
    expect(z.ok && z.dados.submission_days).toBe(0)
  })

  it('strings vazias viram null e active tem padrão true', () => {
    const r = validarOperadora({ ans_registry: '', provider_code: '  ', closing_day: '' })
    expect(r).toEqual({
      ok: true,
      dados: { ans_registry: null, provider_code: null, closing_day: null, submission_days: 10, active: true },
    })
    const f = validarOperadora({ active: false })
    expect(f.ok && f.dados.active).toBe(false)
  })

  it('código do prestador até 30 caracteres', () => {
    expect(validarOperadora({ provider_code: 'x'.repeat(31) })).toEqual({ ok: false, error: 'Código do prestador muito longo' })
    const r = validarOperadora({ provider_code: ' ABC123 ' })
    expect(r.ok && r.dados.provider_code).toBe('ABC123')
  })

  it('corpo que não é objeto é recusado', () => {
    expect(validarOperadora(null).ok).toBe(false)
  })
})

describe('validarItemTabela', () => {
  const base = { code: '81000065', name: 'Consulta', value: 50, requires_authorization: false }

  it('aceita item válido e aplica trim', () => {
    const r = validarItemTabela({ ...base, code: ' 81000065 ', name: ' Consulta ' })
    expect(r).toEqual({ ok: true, dados: base })
  })

  it('valida o código', () => {
    expect(validarItemTabela({ ...base, code: '81 00' })).toEqual({ ok: false, error: 'Código inválido' })
    expect(validarItemTabela({ ...base, code: '' })).toEqual({ ok: false, error: 'Código inválido' })
    expect(validarItemTabela({ ...base, code: 'A'.repeat(21) })).toEqual({ ok: false, error: 'Código inválido' })
  })

  it('valida o nome', () => {
    expect(validarItemTabela({ ...base, name: '   ' })).toEqual({ ok: false, error: 'Nome obrigatório' })
    expect(validarItemTabela({ ...base, name: 'n'.repeat(201) })).toEqual({ ok: false, error: 'Nome obrigatório' })
  })

  it('valida o valor: não negativo, até 2 casas, até 999999.99', () => {
    const msg = { ok: false, error: 'Valor inválido' }
    expect(validarItemTabela({ ...base, value: -1 })).toEqual(msg)
    expect(validarItemTabela({ ...base, value: 12.345 })).toEqual(msg)
    expect(validarItemTabela({ ...base, value: 1000000 })).toEqual(msg)
    expect(validarItemTabela({ ...base, value: 'abc' })).toEqual(msg)
    expect(validarItemTabela({ ...base, value: undefined })).toEqual(msg)
    expect(validarItemTabela({ ...base, value: 0 }).ok).toBe(true)
    expect(validarItemTabela({ ...base, value: 12.5 }).ok).toBe(true)
    expect(validarItemTabela({ ...base, value: '19.9' }).ok).toBe(true)
  })

  it('requires_authorization ausente vira false', () => {
    const r = validarItemTabela({ code: '1', name: 'x', value: 1 })
    expect(r.ok && r.dados.requires_authorization).toBe(false)
  })
})

describe('validarCarteirinha', () => {
  it('aceita carteirinha e validade', () => {
    expect(validarCarteirinha({ insurance_card: ' 0001 ', insurance_card_valid_until: '2027-01-31' })).toEqual({
      ok: true,
      dados: { insurance_card: '0001', insurance_card_valid_until: '2027-01-31' },
    })
  })

  it('vazios viram null', () => {
    expect(validarCarteirinha({ insurance_card: '', insurance_card_valid_until: '' })).toEqual({
      ok: true,
      dados: { insurance_card: null, insurance_card_valid_until: null },
    })
    expect(validarCarteirinha({})).toEqual({
      ok: true,
      dados: { insurance_card: null, insurance_card_valid_until: null },
    })
  })

  it('recusa carteirinha longa e datas inexistentes', () => {
    expect(validarCarteirinha({ insurance_card: 'x'.repeat(31) })).toEqual({ ok: false, error: 'Carteirinha muito longa' })
    expect(validarCarteirinha({ insurance_card: 'x'.repeat(30) }).ok).toBe(true)
    expect(validarCarteirinha({ insurance_card_valid_until: '2026-02-30' })).toEqual({ ok: false, error: 'Data inválida' })
    expect(validarCarteirinha({ insurance_card_valid_until: '31/12/2026' })).toEqual({ ok: false, error: 'Data inválida' })
  })
})

describe('situacaoCarteirinha', () => {
  const hoje = '2026-11-07'
  it('vazia sem carteirinha', () => {
    expect(situacaoCarteirinha(null, null, hoje)).toBe('vazia')
    expect(situacaoCarteirinha('', '2030-01-01', hoje)).toBe('vazia')
  })
  it('vencida quando a validade é anterior a hoje', () => {
    expect(situacaoCarteirinha('123', '2026-11-06', hoje)).toBe('vencida')
    expect(situacaoCarteirinha('123', '2026-11-07', hoje)).toBe('ok')
    expect(situacaoCarteirinha('123', '2026-11-08', hoje)).toBe('ok')
    expect(situacaoCarteirinha('123', null, hoje)).toBe('ok')
  })
})
