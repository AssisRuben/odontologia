import type { NextRequest } from 'next/server'
import { withClinic } from '@/lib/ia/rotas'
import { todayYmd } from '@/lib/messaging/time'
import { createComissoesRepo } from '@/lib/comissoes/repo'
import { resumoMes } from '@/lib/comissoes/calculo'
import { mesEncerrado, mesValido } from '@/lib/comissoes/periodo'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return withClinic('comissoes GET', async ({ clinicId, admin }) => {
    const mes = new URL(req.url).searchParams.get('mes')
    if (!mesValido(mes)) return { status: 422, body: { error: 'Mês inválido' } }
    const hoje = todayYmd(new Date(), 'America/Sao_Paulo')
    const entrada = await createComissoesRepo(admin).entradaCalculo(clinicId)
    return { status: 200, body: { mes, hoje, encerrado: mesEncerrado(mes, hoje), dentistas: resumoMes(entrada, mes) } }
  })
}
