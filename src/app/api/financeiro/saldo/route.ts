import type { NextRequest } from 'next/server'
import { withClinic } from '@/lib/ia/rotas'
import { respostaDeErro } from '@/lib/convenios/rotas'
import { todayYmd } from '@/lib/messaging/time'
import { createFluxoRepo } from '@/lib/fluxo/repo'
import { parseSaldo } from '@/lib/fluxo/validar'
import { ERROS_FLUXO } from '@/lib/fluxo/rotas'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  return withClinic('fluxo saldo', async ({ clinicId, userId, admin }) => {
    const hoje = todayYmd(new Date(), 'America/Sao_Paulo')
    const v = parseSaldo(await req.json().catch(() => null), hoje)
    if (!v.ok) return { status: 422, body: { error: v.error } }
    try {
      await createFluxoRepo(admin).informarSaldo(clinicId, userId, v.input)
      return { status: 201, body: { ok: true } }
    } catch (e) {
      return respostaDeErro(e, ERROS_FLUXO)
    }
  })
}
