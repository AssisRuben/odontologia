import type { NextRequest } from 'next/server'
import { withClinic } from '@/lib/ia/rotas'
import { respostaDeErro } from '@/lib/convenios/rotas'
import { todayYmd } from '@/lib/messaging/time'
import { createFluxoRepo } from '@/lib/fluxo/repo'
import { parseRecorrencia } from '@/lib/fluxo/validar'
import { ERROS_FLUXO } from '@/lib/fluxo/rotas'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  return withClinic('recorrencia criar', async ({ clinicId, admin }) => {
    const hoje = todayYmd(new Date(), 'America/Sao_Paulo')
    const v = parseRecorrencia(await req.json().catch(() => null), 'criar', hoje)
    if (!v.ok) return { status: 422, body: { error: v.error } }
    try {
      return { status: 201, body: { id: await createFluxoRepo(admin).criarRecorrencia(clinicId, v.input) } }
    } catch (e) {
      return respostaDeErro(e, ERROS_FLUXO)
    }
  })
}
