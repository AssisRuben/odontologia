import type { NextRequest } from 'next/server'
import { getAiForClinic } from '@/lib/ia/conexao'
import { NO_KEY_ERROR } from '@/lib/ia/erros'
import { EVOLUCAO_SYSTEM, EvolucaoOutputSchema, montarTexto } from '@/lib/ia/evolucao/esquema'
import { buildFicha } from '@/lib/ia/evolucao/ficha'
import { loadFichaInput } from '@/lib/ia/evolucao/repo'
import { parseOrganizar } from '@/lib/ia/evolucao/salvar'
import { validarSugestoes } from '@/lib/ia/evolucao/sugestoes'
import { createAiDeps, recordUsage } from '@/lib/ia/repo'
import { withClinic } from '@/lib/ia/rotas'
import { todayYmd } from '@/lib/messaging/time'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: unknown = null
  try {
    body = await req.json()
  } catch {
    body = null
  }
  return withClinic('evolucao/organizar', async ({ clinicId, userId, admin }) => {
    const p = parseOrganizar(body)
    if (!p.ok) return { status: p.status, body: { error: p.error } }

    const ai = await getAiForClinic(clinicId, createAiDeps(admin))
    if (!ai) return { status: NO_KEY_ERROR.status, body: { error: NO_KEY_ERROR.error } }

    const input = await loadFichaInput(admin, clinicId, p.patientId)
    if (!input) return { status: 404, body: { error: 'Paciente não encontrado' } }
    const ficha = buildFicha(input, todayYmd(new Date(), 'America/Sao_Paulo'))

    const uso = { kind: 'evolucao' as const, model: ai.model, audio_seconds: null }
    try {
      const r = await ai.client.organize({
        model: ai.model,
        schema: EvolucaoOutputSchema,
        name: 'evolucao',
        system: EVOLUCAO_SYSTEM,
        user: `Ficha do paciente:\n${ficha.texto}\n\nTexto do atendimento:\n${p.texto}`,
      })
      await recordUsage(admin, clinicId, userId, {
        ...uso, input_tokens: r.inputTokens, output_tokens: r.outputTokens, ok: true,
      })
      return {
        status: 200,
        body: {
          texto: montarTexto(r.data.secoes),
          secoes: r.data.secoes,
          sugestoes: validarSugestoes(r.data.sugestoes, ficha.refs),
        },
      }
    } catch (e) {
      await recordUsage(admin, clinicId, userId, { ...uso, input_tokens: null, output_tokens: null, ok: false })
      throw e
    }
  })
}
