import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { respostaDeErro } from '@/lib/convenios/rotas'
import { createFluxoRepo } from '@/lib/fluxo/repo'
import { parseEncerrar } from '@/lib/fluxo/validar'
import { ERROS_FLUXO } from '@/lib/fluxo/rotas'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return withClinic('recorrencia encerrar', async ({ clinicId, admin }) => {
    if (!isUuid(id)) return { status: 404, body: { error: 'Recorrência não encontrada' } }
    const v = parseEncerrar(await req.json().catch(() => null))
    if (!v.ok) return { status: 422, body: { error: v.error } }
    try {
      const apagadas = await createFluxoRepo(admin).encerrarRecorrencia(clinicId, id, v.ultimoMes)
      return { status: 200, body: { apagadas } }
    } catch (e) {
      return respostaDeErro(e, ERROS_FLUXO)
    }
  })
}
