import { describe, it, expect } from 'vitest'
import {
  validateConfig, configToForm, KIND_LABELS, STATUS_LABELS, REPLY_LABELS, buildPreviewContext, insertAtCursor,
  errorLabel, formatWhatsAppPhone,
} from '@/components/mensagens/helpers'

describe('validateConfig', () => {
  it('aceita horas 1-72 para confirmação e lembrete', () => {
    expect(validateConfig('confirmation', { offset: '24', days: [] })).toEqual({ ok: true, config: { offset_hours: 24 } })
    expect(validateConfig('reminder', { offset: '72', days: [] })).toEqual({ ok: true, config: { offset_hours: 72 } })
  })
  it('rejeita horas fora da faixa ou não inteiras', () => {
    for (const v of ['0', '73', '', '1.5', 'abc', '-1']) {
      expect(validateConfig('confirmation', { offset: v, days: [] }).ok).toBe(false)
    }
  })
  it('recall: meses 1-24', () => {
    expect(validateConfig('recall', { offset: '6', days: [] })).toEqual({ ok: true, config: { offset_months: 6 } })
    expect(validateConfig('recall', { offset: '25', days: [] }).ok).toBe(false)
    expect(validateConfig('recall', { offset: '0', days: [] }).ok).toBe(false)
  })
  it('charge: ordena e remove duplicados', () => {
    expect(validateConfig('charge', { offset: '', days: ['7', '1'] })).toEqual({ ok: true, config: { offset_days: [1, 7] } })
    expect(validateConfig('charge', { offset: '', days: ['5', '5'] })).toEqual({ ok: true, config: { offset_days: [5] } })
  })
  it('charge: rejeita fora de 1-60 ou vazio', () => {
    expect(validateConfig('charge', { offset: '', days: ['0', '7'] }).ok).toBe(false)
    expect(validateConfig('charge', { offset: '', days: ['1', '61'] }).ok).toBe(false)
    expect(validateConfig('charge', { offset: '', days: ['1', ''] }).ok).toBe(false)
  })
  it('birthday: config vazia', () => {
    expect(validateConfig('birthday', { offset: '', days: [] })).toEqual({ ok: true, config: {} })
  })
  it('mensagens de erro em português', () => {
    const r = validateConfig('confirmation', { offset: '0', days: [] })
    expect(r.ok === false && r.error).toMatch(/1 a 72/)
  })
})

describe('configToForm', () => {
  it('usa padrões quando a config está vazia', () => {
    expect(configToForm('charge', {}).days).toEqual(['1', '7'])
    expect(configToForm('recall', {}).offset).toBe('6')
    expect(configToForm('confirmation', { offset_hours: 12 }).offset).toBe('12')
  })
})

describe('rótulos', () => {
  it('tipos', () => {
    expect(KIND_LABELS).toEqual({
      confirmation: 'Confirmação', reminder: 'Lembrete', recall: 'Retorno', birthday: 'Aniversário',
      charge: 'Cobrança', payment_due: 'Lembrete de vencimento', budget: 'Orçamento', budget_reminder: 'Lembrete de orçamento', manual: 'Manual', auto_reply: 'Resposta automática', incoming: 'Recebida',
      agent: 'Assistente', human: 'Equipe',
    })
  })
  it('status e respostas', () => {
    expect(STATUS_LABELS).toEqual({
      queued: 'Na fila', sending: 'Enviando', sent: 'Enviada', failed: 'Falhou', cancelled: 'Cancelada', received: 'Recebida',
    })
    expect(REPLY_LABELS).toEqual({ confirmed: 'Confirmou', cancelled: 'Desmarcou' })
  })
})

describe('buildPreviewContext', () => {
  it('monta paciente, consulta de amanhã 14:30, profissional e cobrança', () => {
    const now = new Date('2026-11-02T15:00:00Z')
    const ctx = buildPreviewContext('Clínica Teste', 'America/Sao_Paulo', now)
    expect(ctx.paciente).toBe('Maria')
    expect(ctx.paciente_completo).toBe('Maria Silva Santos')
    expect(ctx.hora).toBe('14:30')
    expect(ctx.data).toBe('terça, 03/11')
    expect(ctx.profissional).toBe('Dra. Ana Ferreira')
    expect(ctx.clinica).toBe('Clínica Teste')
    expect(ctx.valor).toMatch(/150,00/)
    expect(ctx.vencimento).toBe('30/10/2026')
  })
  it('"amanhã" respeita o fuso (01h UTC ainda é o dia anterior em SP)', () => {
    // 2026-11-03T01:00Z = 02/11 22h em SP, então amanhã = 03/11
    const ctx = buildPreviewContext('C', 'America/Sao_Paulo', new Date('2026-11-03T01:00:00Z'))
    expect(ctx.data).toBe('terça, 03/11')
  })
})

describe('insertAtCursor', () => {
  it('insere na posição e devolve o cursor', () => {
    expect(insertAtCursor('Olá, !', 5, 5, '{paciente}')).toEqual({ value: 'Olá, {paciente}!', cursor: 15 })
  })
  it('substitui a seleção', () => {
    expect(insertAtCursor('abcdef', 1, 3, 'X')).toEqual({ value: 'aXdef', cursor: 2 })
  })
})

describe('resolveTz', () => {
  it('mantém fuso válido e cai no padrão para inválido', async () => {
    const { resolveTz } = await import('@/components/mensagens/helpers')
    expect(resolveTz('America/Manaus')).toBe('America/Manaus')
    expect(resolveTz('Nao/Existe')).toBe('America/Sao_Paulo')
    expect(resolveTz(undefined)).toBe('America/Sao_Paulo')
  })
})

describe('errorLabel', () => {
  it('traduz os códigos do servidor', () => {
    expect(errorLabel('sem_conexao')).toBe('WhatsApp desconectado')
    expect(errorLabel('daily_limit')).toBe('Limite diário atingido')
    expect(errorLabel('appointment_changed')).toBe('Consulta alterada')
    expect(errorLabel('not_confirmed')).toBe('Consulta não confirmada')
    expect(errorLabel('paid')).toBe('Pagamento quitado')
    expect(errorLabel('opt_out')).toBe('Paciente optou por não receber')
    expect(errorLabel('expired')).toBe('Expirada')
  })
  it('outro texto aparece como está', () => {
    expect(errorLabel('Número não possui WhatsApp')).toBe('Número não possui WhatsApp')
  })
})

describe('formatWhatsAppPhone', () => {
  it('formata o telefone canônico', () => {
    expect(formatWhatsAppPhone('5511987654321')).toBe('(11) 98765-4321')
    expect(formatWhatsAppPhone('551133334444')).toBe('(11) 3333-4444')
  })
  it('vazio e formatos desconhecidos', () => {
    expect(formatWhatsAppPhone(null)).toBe('')
    expect(formatWhatsAppPhone('123')).toBe('123')
  })
})
