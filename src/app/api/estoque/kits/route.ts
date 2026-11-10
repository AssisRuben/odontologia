import type { NextRequest } from 'next/server'
import { withClinic } from '@/lib/ia/rotas'
import { respostaDeErro } from '@/lib/convenios/rotas'
import { createKitsRepo } from '@/lib/kits/repo'
import { parseKit } from '@/lib/kits/validar'
import { ERROS_KITS } from '@/lib/kits/rotas'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withClinic('kits listar', async ({ clinicId, admin }) => {
    return { status: 200, body: { kits: await createKitsRepo(admin).listar(clinicId) } }
  })
}

export async function POST(req: NextRequest) {
  return withClinic('kits criar', async ({ clinicId, admin }) => {
    const v = parseKit(await req.json().catch(() => null), 'criar')
    if (!v.ok) return { status: 422, body: { error: v.error } }
    try {
      return { status: 201, body: { id: await createKitsRepo(admin).criar(clinicId, v.input) } }
    } catch (e) {
      return respostaDeErro(e, ERROS_KITS)
    }
  })
}
