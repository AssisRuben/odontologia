import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { createKitsRepo } from '@/lib/kits/repo'
import { parseBaixa } from '@/lib/kits/validar'
import { respostaErroKits } from '@/lib/kits/rotas'

export const dynamic = 'force-dynamic'

const NAO_ENCONTRADO = { status: 404, body: { error: 'Tratamento não encontrado' } }

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return withClinic('tratamento material', async ({ clinicId, admin }) => {
    if (!isUuid(id)) return NAO_ENCONTRADO
    const info = await createKitsRepo(admin).material(clinicId, id)
    return info ? { status: 200, body: info } : NAO_ENCONTRADO
  })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return withClinic('tratamento baixa', async ({ clinicId, userId, admin }) => {
    if (!isUuid(id)) return NAO_ENCONTRADO
    const v = parseBaixa(await req.json().catch(() => null))
    if (!v.ok) return { status: 422, body: { error: v.error } }
    const repo = createKitsRepo(admin)
    try {
      return { status: 200, body: await repo.baixar(clinicId, userId, id, v.input) }
    } catch (e) {
      return respostaErroKits(e, (itemId) => repo.nomeProduto(clinicId, itemId))
    }
  })
}
