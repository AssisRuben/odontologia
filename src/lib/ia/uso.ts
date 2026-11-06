import { PRICES_USD } from './modelos'
import { todayYmd, zonedDateTime } from '@/lib/messaging/time'

const TZ = 'America/Sao_Paulo'

export type UsageRow = {
  kind: 'transcricao' | 'evolucao' | 'anamnese'
  model: string
  audio_seconds: number | null
  input_tokens: number | null
  output_tokens: number | null
  ok: boolean
}

export function summarizeUsage(rows: UsageRow[]): {
  audioMinutes: number
  transcricoes: number
  evolucoes: number
  anamneses: number
  estimatedUsd: number
} {
  let seconds = 0
  let usd = 0
  let transcricoes = 0
  let evolucoes = 0
  let anamneses = 0
  for (const r of rows) {
    const audio = r.audio_seconds ?? 0
    seconds += audio
    usd += (audio / 60) * PRICES_USD.transcribePerMinute
    const p = PRICES_USD.text[r.model]
    if (p) usd += ((r.input_tokens ?? 0) * p.input + (r.output_tokens ?? 0) * p.output) / 1_000_000
    if (!r.ok) continue
    if (r.kind === 'transcricao') transcricoes++
    else if (r.kind === 'evolucao') evolucoes++
    else anamneses++
  }
  return {
    audioMinutes: Math.round((seconds / 60) * 10) / 10,
    transcricoes,
    evolucoes,
    anamneses,
    estimatedUsd: Math.round(usd * 100) / 100,
  }
}

/** 1º dia do mês corrente em America/Sao_Paulo, como ISO UTC. */
export function monthStartIso(now: Date): string {
  const ym = todayYmd(now, TZ).slice(0, 7)
  return zonedDateTime(`${ym}-01`, '00:00', TZ).toISOString()
}
