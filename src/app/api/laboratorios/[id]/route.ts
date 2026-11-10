import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { respostaDeErro } from '@/lib/convenios/rotas'
import { createProteseRepo } from '@/lib/protese/repo'
import { parseLaboratorioParcial } from '@/lib/protese/validar'
import { ERROS_LABORATORIO } from '@/lib/protese/rotas'

export const dynamic = 'force-dynamic'

const NAO_ENCONTRADO = { status: 404, body: { error: 'Laboratório não encontrado' } }

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return withClinic('laboratorios PATCH', async ({ clinicId, admin }) => {
    if (!isUuid(id)) return NAO_ENCONTRADO
    const v = parseLaboratorioParcial(await req.json().catch(() => null))
    if (!v.ok) return { status: 422, body: { error: v.error } }
    try {
      const achou = await createProteseRepo(admin).editarLaboratorio(clinicId, id, v.input)
      return achou ? { status: 200, body: { ok: true } } : NAO_ENCONTRADO
    } catch (e) {
      return respostaDeErro(e, ERROS_LABORATORIO)
    }
  })
}
