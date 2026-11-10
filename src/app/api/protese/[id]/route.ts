import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { respostaDeErro } from '@/lib/convenios/rotas'
import { createProteseRepo } from '@/lib/protese/repo'
import { parseProtese } from '@/lib/protese/validar'
import { ERROS_PROTESE } from '@/lib/protese/rotas'

export const dynamic = 'force-dynamic'

const NAO_ENCONTRADO = { status: 404, body: { error: 'Trabalho não encontrado' } }

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return withClinic('protese PATCH', async ({ clinicId, admin }) => {
    if (!isUuid(id)) return NAO_ENCONTRADO
    const v = parseProtese(await req.json().catch(() => null))
    if (!v.ok) return { status: 422, body: { error: v.error } }
    try {
      return { status: 200, body: await createProteseRepo(admin).editar(clinicId, id, v.input) }
    } catch (e) {
      return respostaDeErro(e, ERROS_PROTESE)
    }
  })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return withClinic('protese DELETE', async ({ clinicId, admin }) => {
    if (!isUuid(id)) return NAO_ENCONTRADO
    try {
      return { status: 200, body: await createProteseRepo(admin).excluir(clinicId, id) }
    } catch (e) {
      return respostaDeErro(e, ERROS_PROTESE)
    }
  })
}
