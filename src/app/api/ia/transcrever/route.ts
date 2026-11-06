import type { NextRequest } from 'next/server'
import { checkAudio } from '@/lib/ia/audio'
import { getAiForClinic } from '@/lib/ia/conexao'
import { NO_KEY_ERROR } from '@/lib/ia/erros'
import { TRANSCRIBE_MODEL } from '@/lib/ia/modelos'
import { createAiDeps, recordUsage } from '@/lib/ia/repo'
import { withClinic } from '@/lib/ia/rotas'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let form: FormData | null = null
  try {
    form = await req.formData()
  } catch {
    form = null
  }
  return withClinic('transcrever', async ({ clinicId, userId, admin }) => {
    const audio = form?.get('audio')
    const file = audio instanceof File ? audio : null
    const check = checkAudio(file, Number(form?.get('seconds')))
    if (!check.ok || !file) {
      const c = check.ok ? { status: 422, error: 'Áudio inválido' } : check
      return { status: c.status, body: { error: c.error } }
    }

    const ai = await getAiForClinic(clinicId, createAiDeps(admin))
    if (!ai) return { status: NO_KEY_ERROR.status, body: { error: NO_KEY_ERROR.error } }

    const uso = { kind: 'transcricao' as const, model: TRANSCRIBE_MODEL, audio_seconds: check.seconds, input_tokens: null, output_tokens: null }
    const renamed = new File([file], `audio.${check.ext}`, { type: file.type })
    try {
      const texto = await ai.client.transcribe(renamed)
      await recordUsage(admin, clinicId, userId, { ...uso, ok: true })
      return { status: 200, body: { texto } }
    } catch (e) {
      await recordUsage(admin, clinicId, userId, { ...uso, ok: false })
      throw e
    }
  })
}
