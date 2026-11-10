import { addMonths, endOfMonth, format, parseISO, startOfMonth } from 'date-fns'
import { withClinic } from '@/lib/ia/rotas'
import { respostaDeErro } from '@/lib/convenios/rotas'
import { todayYmd } from '@/lib/messaging/time'
import { montarFluxo } from '@/lib/fluxo/calcular'
import { createFluxoRepo } from '@/lib/fluxo/repo'
import { ERROS_FLUXO } from '@/lib/fluxo/rotas'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withClinic('fluxo', async ({ clinicId, admin }) => {
    const repo = createFluxoRepo(admin)
    const hoje = todayYmd(new Date(), 'America/Sao_Paulo')
    const h = parseISO(hoje)
    const janela = {
      inicio: format(startOfMonth(addMonths(h, -2)), 'yyyy-MM-dd'),
      fim: format(endOfMonth(addMonths(h, 5)), 'yyyy-MM-dd'),
    }
    try {
      await repo.gerar(clinicId)
      const saldo = await repo.saldoAtual(clinicId)
      const desde = saldo && saldo.data < janela.inicio ? saldo.data : janela.inicio
      const { pagamentos, despesas } = await repo.dados(clinicId, janela, desde)
      const fluxo = montarFluxo({ hoje, saldo, pagamentos, despesas })
      return { status: 200, body: { ...fluxo, saldoInformado: saldo } }
    } catch (e) {
      return respostaDeErro(e, ERROS_FLUXO)
    }
  })
}
