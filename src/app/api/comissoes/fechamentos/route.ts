import type { NextRequest } from 'next/server'
import { withClinic } from '@/lib/ia/rotas'
import { todayYmd } from '@/lib/messaging/time'
import { respostaDeErro } from '@/lib/convenios/rotas'
import { createComissoesRepo } from '@/lib/comissoes/repo'
import { extrato } from '@/lib/comissoes/calculo'
import { mesEncerrado, primeiroDia } from '@/lib/comissoes/periodo'
import { validarFechamento } from '@/lib/comissoes/validar'
import { ERROS_COMISSAO } from '@/lib/comissoes/rotas'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  return withClinic('comissoes fechamentos POST', async ({ clinicId, admin }) => {
    const v = validarFechamento(await req.json().catch(() => null))
    if (!v.ok) return { status: v.status, body: { error: v.error } }
    const repo = createComissoesRepo(admin)
    const prof = await repo.profissional(clinicId, v.professionalId)
    if (!prof) return { status: 404, body: { error: 'Profissional não encontrado' } }
    if (!mesEncerrado(v.mes, todayYmd(new Date(), 'America/Sao_Paulo'))) {
      return { status: 409, body: { error: 'O mês ainda não terminou' } }
    }
    if (prof.commission_start === null || primeiroDia(v.mes) < prof.commission_start) {
      return { status: 409, body: { error: 'Mês anterior ao início da comissão' } }
    }
    const x = extrato(await repo.entradaCalculo(clinicId), v.professionalId, v.mes)
    if (x.totalCentavos <= 0) return { status: 409, body: { error: 'Não há comissão a fechar neste mês' } }
    try {
      const id = await repo.fecharMes(clinicId, v.professionalId, v.mes, x)
      return { status: 201, body: { id } }
    } catch (e) {
      return respostaDeErro(e, ERROS_COMISSAO)
    }
  })
}
