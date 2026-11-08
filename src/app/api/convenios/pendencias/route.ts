import { withClinic } from '@/lib/ia/rotas'
import { createConveniosRepo } from '@/lib/convenios/repo'
import { montarLotes } from '@/lib/convenios/montagem'
import { montarPendencias } from '@/lib/convenios/pendencias'
import { todayYmd } from '@/lib/messaging/time'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withClinic('convenios pendencias GET', async ({ clinicId, admin }) => {
    const repo = createConveniosRepo(admin)
    // Monta os lotes antes: item pronto entra no lote e o prazo do lote vira alerta
    // mesmo que ninguém abra a aba Lotes.
    await montarLotes(clinicId, repo)
    const hoje = todayYmd(new Date(), 'America/Sao_Paulo')
    const dados = await repo.dadosPendencias(clinicId, hoje)
    return { status: 200, body: montarPendencias({ hoje, ...dados }) }
  })
}
