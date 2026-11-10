import type { NextRequest } from 'next/server'
import { withClinic } from '@/lib/ia/rotas'
import { todayYmd } from '@/lib/messaging/time'
import { respostaDeErro } from '@/lib/convenios/rotas'
import { createEstoqueRepo } from '@/lib/estoque/repo'
import { parseProduto } from '@/lib/estoque/validar'
import { ERROS_ESTOQUE } from '@/lib/estoque/rotas'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return withClinic('estoque GET', async ({ clinicId, admin }) => {
    const inativos = new URL(req.url).searchParams.get('inativos') === '1'
    const hoje = todayYmd(new Date(), 'America/Sao_Paulo')
    const itens = await createEstoqueRepo(admin).listar(clinicId, { inativos })
    return { status: 200, body: { hoje, itens } }
  })
}

export async function POST(req: NextRequest) {
  return withClinic('estoque POST', async ({ clinicId, userId, admin }) => {
    const v = parseProduto(await req.json().catch(() => null), true)
    if (!v.ok) return { status: 422, body: { error: v.error } }
    try {
      const id = await createEstoqueRepo(admin).criar(clinicId, userId, v.input)
      return { status: 201, body: { id } }
    } catch (e) {
      return respostaDeErro(e, ERROS_ESTOQUE)
    }
  })
}
