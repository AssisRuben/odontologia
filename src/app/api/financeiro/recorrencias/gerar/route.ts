import { withClinic } from '@/lib/ia/rotas'
import { respostaDeErro } from '@/lib/convenios/rotas'
import { createFluxoRepo } from '@/lib/fluxo/repo'
import { ERROS_FLUXO } from '@/lib/fluxo/rotas'

export const dynamic = 'force-dynamic'

export async function POST() {
  return withClinic('recorrencia gerar', async ({ clinicId, admin }) => {
    try {
      return { status: 200, body: { criadas: await createFluxoRepo(admin).gerar(clinicId) } }
    } catch (e) {
      return respostaDeErro(e, ERROS_FLUXO)
    }
  })
}
