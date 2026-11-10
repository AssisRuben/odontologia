import { describe, it, expect } from 'vitest'
import { diasParaVencer, situacaoLote, proximaValidade } from '@/lib/estoque/validade'
import { todayYmd } from '@/lib/messaging/time'

describe('validade', () => {
  it('diasParaVencer', () => {
    expect(diasParaVencer('2026-11-10', '2026-11-10')).toBe(0)
    expect(diasParaVencer('2026-11-09', '2026-11-10')).toBe(-1)
    expect(diasParaVencer('2026-12-10', '2026-11-10')).toBe(30)
    expect(diasParaVencer('2027-01-01', '2026-12-31')).toBe(1)
  })
  it('limites: hoje, 30 e 31 dias', () => {
    const h = '2026-11-10'
    expect(situacaoLote('2026-11-10', h)).toBe('vence_em_breve')
    expect(situacaoLote('2026-11-09', h)).toBe('vencido')
    expect(situacaoLote('2026-12-10', h)).toBe('vence_em_breve')
    expect(situacaoLote('2026-12-11', h)).toBe('ok')
    expect(situacaoLote(null, h)).toBe('sem_validade')
  })
  it('meia-noite UTC ainda é o dia de São Paulo', () => {
    const hoje = todayYmd(new Date('2026-11-11T02:00:00Z'), 'America/Sao_Paulo')
    expect(hoje).toBe('2026-11-10')
    expect(situacaoLote('2026-11-10', hoje)).toBe('vence_em_breve')
  })
  it('proximaValidade ignora saldo 0 e sem validade', () => {
    expect(proximaValidade([])).toBeNull()
    expect(
      proximaValidade([
        { expires_at: '2026-12-01', quantity: 0 },
        { expires_at: null, quantity: 5 },
        { expires_at: '2027-02-01', quantity: 2 },
        { expires_at: '2027-01-01', quantity: 1 },
      ]),
    ).toBe('2027-01-01')
  })
})
