import type { NextRequest } from 'next/server'
import { withClinic } from '@/lib/ia/rotas'
import { isUuid } from '@/lib/ia/uuid'
import { mesValido } from '@/lib/comissoes/periodo'
import { montarPainel } from '@/lib/indicadores/painel'
import { mesesJanela } from '@/lib/indicadores/periodo'
import { entradaPainel } from '@/lib/indicadores/repo'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return withClinic('indicadores GET', async ({ clinicId, admin }) => {
    const params = new URL(req.url).searchParams
    const mes = params.get('mes')
    if (!mesValido(mes)) return { status: 422, body: { error: 'Mês inválido' } }
    const dentista = params.get('dentista')
    if (dentista !== null && !isUuid(dentista)) return { status: 422, body: { error: 'Identificador inválido' } }

    const entrada = await entradaPainel(admin, clinicId, mesesJanela(mes))
    if (dentista !== null && !entrada.profissionais.some((p) => p.id === dentista)) {
      return { status: 404, body: { error: 'Profissional não encontrado' } }
    }
    return { status: 200, body: montarPainel(entrada, mes, new Date(), dentista) }
  })
}
