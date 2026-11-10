import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { respostaDeErro } from '@/lib/convenios/rotas'
import { todayYmd } from '@/lib/messaging/time'
import { createFluxoRepo } from '@/lib/fluxo/repo'
import { parseRecorrencia } from '@/lib/fluxo/validar'
import { ERROS_FLUXO } from '@/lib/fluxo/rotas'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return withClinic('recorrencia editar', async ({ clinicId, admin }) => {
    if (!isUuid(id)) return { status: 404, body: { error: 'Recorrência não encontrada' } }
    const hoje = todayYmd(new Date(), 'America/Sao_Paulo')
    const v = parseRecorrencia(await req.json().catch(() => null), 'editar', hoje)
    if (!v.ok) return { status: 422, body: { error: v.error } }
    try {
      const alteradas = await createFluxoRepo(admin).editarRecorrencia(clinicId, id, v.input)
      return { status: 200, body: { alteradas } }
    } catch (e) {
      return respostaDeErro(e, ERROS_FLUXO)
    }
  })
}
