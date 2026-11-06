export const TRANSCRIBE_MODEL = 'gpt-transcribe'
export const TEXT_MODELS = { economico: 'gpt-6-luna', caprichado: 'gpt-6.1-terra' } as const

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024
export const MAX_AUDIO_SECONDS = 600
export const MAX_TEXT_CHARS = 20000
export const AI_TIMEOUT_MS = 60000
/** Chamadas no caminho do WhatsApp (webhook, agente, testar): curtas e sem novas tentativas. */
export const WA_AI_TIMEOUT_MS = 20_000
export const WA_AI_OPTIONS = { timeoutMs: WA_AI_TIMEOUT_MS, maxRetries: 0 } as const

/** Preços em US$: transcrição por minuto; texto por milhão de tokens. */
export const PRICES_USD: {
  transcribePerMinute: number
  text: Record<string, { input: number; output: number }>
} = {
  transcribePerMinute: 0.0045,
  text: {
    'gpt-6-luna': { input: 0.1, output: 0.5 },
    'gpt-6.1-terra': { input: 1, output: 5 },
  },
}
