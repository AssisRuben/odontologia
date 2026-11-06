import type { NextRequest } from 'next/server'
import { AnamneseOutputSchema, ANAMNESE_SYSTEM, perguntasTexto, type Pergunta } from '@/lib/ia/anamnese/esquema'
import { parsePreencher, validarRespostas } from '@/lib/ia/anamnese/respostas'
import { getAiForClinic } from '@/lib/ia/conexao'
import { NO_KEY_ERROR } from '@/lib/ia/erros'
import { createAiDeps, recordUsage } from '@/lib/ia/repo'
import { withClinic } from '@/lib/ia/rotas'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: unknown = null
  try {
    body = await req.json()
  } catch {
    body = null
  }
  return withClinic('anamnese/preencher', async ({ clinicId, userId, admin }) => {
    const p = parsePreencher(body)
    if (!p.ok) return { status: p.status, body: { error: p.error } }

    const ai = await getAiForClinic(clinicId, createAiDeps(admin))
    if (!ai) return { status: NO_KEY_ERROR.status, body: { error: NO_KEY_ERROR.error } }

    const { data: modelo, error } = await admin
      .from('anamnesis_templates')
      .select('questions')
      .eq('id', p.templateId)
      .eq('clinic_id', clinicId)
      .maybeSingle()
    if (error) throw new Error('falha ao buscar modelo de anamnese')
    if (!modelo) return { status: 404, body: { error: 'Modelo de anamnese não encontrado' } }
    const perguntas: Pergunta[] = Array.isArray(modelo.questions) ? modelo.questions : []

    const uso = { kind: 'anamnese' as const, model: ai.model, audio_seconds: null }
    let r
    try {
      r = await ai.client.organize({
        model: ai.model,
        schema: AnamneseOutputSchema,
        name: 'anamnese',
        system: ANAMNESE_SYSTEM,
        user: `Perguntas:\n${perguntasTexto(perguntas)}\n\nTexto:\n${p.texto}`,
      })
      await recordUsage(admin, clinicId, userId, {
        ...uso, input_tokens: r.inputTokens, output_tokens: r.outputTokens, ok: true,
      })
    } catch (e) {
      await recordUsage(admin, clinicId, userId, { ...uso, input_tokens: null, output_tokens: null, ok: false })
      throw e
    }
    return { status: 200, body: validarRespostas(r.data, perguntas) }
  })
}
