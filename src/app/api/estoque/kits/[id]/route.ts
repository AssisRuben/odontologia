import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { respostaDeErro } from '@/lib/convenios/rotas'
import { createKitsRepo } from '@/lib/kits/repo'
import { parseKit } from '@/lib/kits/validar'
import { ERROS_KITS } from '@/lib/kits/rotas'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return withClinic('kits editar', async ({ clinicId, admin }) => {
    if (!isUuid(id)) return { status: 404, body: { error: 'Kit não encontrado' } }
    const v = parseKit(await req.json().catch(() => null), 'editar')
    if (!v.ok) return { status: 422, body: { error: v.error } }
    try {
      await createKitsRepo(admin).editar(clinicId, id, v.input)
      return { status: 200, body: { ok: true } }
    } catch (e) {
      return respostaDeErro(e, ERROS_KITS)
    }
  })
}
