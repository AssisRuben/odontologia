import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { respostaDeErro } from '@/lib/convenios/rotas'
import { createProteseRepo } from '@/lib/protese/repo'
import { parseMover } from '@/lib/protese/validar'
import { ERROS_PROTESE } from '@/lib/protese/rotas'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return withClinic('protese mover POST', async ({ clinicId, userId, admin }) => {
    if (!isUuid(id)) return { status: 404, body: { error: 'Trabalho não encontrado' } }
    const v = parseMover(await req.json().catch(() => null))
    if (!v.ok) return { status: 422, body: { error: v.error } }
    try {
      return { status: 200, body: await createProteseRepo(admin).mover(clinicId, userId, id, v.input) }
    } catch (e) {
      return respostaDeErro(e, ERROS_PROTESE)
    }
  })
}
