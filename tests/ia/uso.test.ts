import { describe, it, expect } from 'vitest'
import { summarizeUsage, monthStartIso, type UsageRow } from '@/lib/ia/uso'

describe('summarizeUsage', () => {
  it('soma minutos e custo', () => {
    const rows: UsageRow[] = [
      { kind: 'transcricao', model: 'gpt-transcribe', audio_seconds: 120, input_tokens: null, output_tokens: null, ok: true },
      { kind: 'evolucao', model: 'gpt-6-luna', audio_seconds: null, input_tokens: 4000, output_tokens: 1500, ok: true },
    ]
    expect(summarizeUsage(rows)).toEqual({ audioMinutes: 2, transcricoes: 1, evolucoes: 1, anamneses: 0, estimatedUsd: 0.01 })
  })

  it('linhas com falha não entram na contagem, mas entram no custo', () => {
    const rows: UsageRow[] = [
      { kind: 'anamnese', model: 'gpt-6.1-terra', audio_seconds: null, input_tokens: 1_000_000, output_tokens: 0, ok: false },
      { kind: 'anamnese', model: 'modelo-desconhecido', audio_seconds: null, input_tokens: 5000, output_tokens: 5000, ok: true },
    ]
    const s = summarizeUsage(rows)
    expect(s.anamneses).toBe(1)
    expect(s.estimatedUsd).toBe(1)
  })

  it('arredonda minutos para 1 casa', () => {
    const s = summarizeUsage([
      { kind: 'transcricao', model: 'gpt-transcribe', audio_seconds: 100, input_tokens: null, output_tokens: null, ok: true },
    ])
    expect(s.audioMinutes).toBe(1.7)
  })
})

describe('monthStartIso', () => {
  it('usa o mês de São Paulo', () => {
    expect(monthStartIso(new Date('2026-11-01T02:00:00Z'))).toBe('2026-10-01T03:00:00.000Z')
    expect(monthStartIso(new Date('2026-11-15T12:00:00Z'))).toBe('2026-11-01T03:00:00.000Z')
  })
})
