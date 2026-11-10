import type { NextRequest } from 'next/server'
import { withClinic } from '@/lib/ia/rotas'
import { respostaDeErro } from '@/lib/convenios/rotas'
import { createProteseRepo } from '@/lib/protese/repo'
import { parseLaboratorio } from '@/lib/protese/validar'
import { ERROS_LABORATORIO } from '@/lib/protese/rotas'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withClinic('laboratorios GET', async ({ clinicId, admin }) => {
    return { status: 200, body: { itens: await createProteseRepo(admin).laboratorios(clinicId) } }
  })
}

export async function POST(req: NextRequest) {
  return withClinic('laboratorios POST', async ({ clinicId, admin }) => {
    const v = parseLaboratorio(await req.json().catch(() => null))
    if (!v.ok) return { status: 422, body: { error: v.error } }
    try {
      return { status: 201, body: { laboratorio: await createProteseRepo(admin).criarLaboratorio(clinicId, v.input) } }
    } catch (e) {
      return respostaDeErro(e, ERROS_LABORATORIO)
    }
  })
}
