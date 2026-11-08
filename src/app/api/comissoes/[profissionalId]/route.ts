import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { createComissoesRepo } from '@/lib/comissoes/repo'
import { extrato } from '@/lib/comissoes/calculo'
import { mesValido } from '@/lib/comissoes/periodo'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, ctx: RouteContext<'/api/comissoes/[profissionalId]'>) {
  const { profissionalId } = await ctx.params
  return withClinic('comissoes extrato GET', async ({ clinicId, admin }) => {
    if (!isUuid(profissionalId)) return { status: 422, body: { error: 'Identificador inválido' } }
    const mes = new URL(req.url).searchParams.get('mes')
    if (!mesValido(mes)) return { status: 422, body: { error: 'Mês inválido' } }
    const repo = createComissoesRepo(admin)
    if (!(await repo.profissional(clinicId, profissionalId))) {
      return { status: 404, body: { error: 'Profissional não encontrado' } }
    }
    return { status: 200, body: extrato(await repo.entradaCalculo(clinicId), profissionalId, mes) }
  })
}
