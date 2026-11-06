import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
} from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import type { z } from 'zod'
import { AiError } from './erros'
import { AI_TIMEOUT_MS, TRANSCRIBE_MODEL } from './modelos'

interface OrganizeArgs<T> {
  model: string
  schema: z.ZodType<T>
  name: string
  system: string
  user: string
}

export interface AiClient {
  transcribe(audio: File): Promise<string>
  organize<T>(args: OrganizeArgs<T>): Promise<{ data: T; inputTokens: number; outputTokens: number }>
  testKey(): Promise<void>
}

export function toAiError(e: unknown): AiError {
  if (e instanceof AiError) return e
  if (e instanceof AuthenticationError || e instanceof PermissionDeniedError) return new AiError('invalid_key')
  if (e instanceof RateLimitError) return new AiError('rate_limited')
  if (e instanceof APIConnectionTimeoutError) return new AiError('timeout')
  if (e instanceof APIConnectionError || e instanceof APIError) return new AiError('unavailable')
  return new AiError('unavailable')
}

export function makeAiClient(apiKey: string, sdk?: OpenAI): AiClient {
  const openai = sdk ?? new OpenAI({ apiKey, timeout: AI_TIMEOUT_MS, maxRetries: 1 })

  return {
    async transcribe(audio) {
      try {
        const res = await openai.audio.transcriptions.create({
          model: TRANSCRIBE_MODEL,
          file: audio,
          languages: ['pt'],
        })
        return res.text
      } catch (e) {
        throw toAiError(e)
      }
    },

    async organize<T>({ model, schema, name, system, user }: OrganizeArgs<T>) {
      try {
        const res = await openai.responses.parse({
          model,
          input: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          text: { format: zodTextFormat(schema, name) },
        })
        const data = res.output_parsed
        if (data == null) throw new AiError('bad_output')
        return {
          data: data as T,
          inputTokens: res.usage?.input_tokens ?? 0,
          outputTokens: res.usage?.output_tokens ?? 0,
        }
      } catch (e) {
        // Saída que não passa no schema: o SDK lança erro de validação do zod.
        if (e instanceof Error && e.name === 'ZodError') throw new AiError('bad_output')
        throw toAiError(e)
      }
    },

    async testKey() {
      try {
        await openai.models.list()
      } catch (e) {
        throw toAiError(e)
      }
    },
  }
}
