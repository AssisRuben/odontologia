import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { todayYmd } from '@/lib/messaging/time'
import { respostaDeErro } from '@/lib/convenios/rotas'
import { createProteseRepo } from '@/lib/protese/repo'
import { parseProtese } from '@/lib/protese/validar'
import { ERROS_PROTESE } from '@/lib/protese/rotas'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return withClinic('protese GET', async ({ clinicId, admin }) => {
    const sp = new URL(req.url).searchParams
    const paciente = sp.get('paciente')
    if (paciente !== null && !isUuid(paciente)) return { status: 422, body: { error: 'Paciente inválido' } }
    const hoje = todayYmd(new Date(), 'America/Sao_Paulo')
    const itens = await createProteseRepo(admin).listar(clinicId, {
      pacienteId: paciente ?? undefined,
      todas: sp.get('instaladas') === 'todas',
      hojeYmd: hoje,
    })
    return { status: 200, body: { hoje, itens } }
  })
}

export async function POST(req: NextRequest) {
  return withClinic('protese POST', async ({ clinicId, userId, admin }) => {
    const v = parseProtese(await req.json().catch(() => null))
    if (!v.ok) return { status: 422, body: { error: v.error } }
    try {
      const id = await createProteseRepo(admin).criar(clinicId, userId, v.input)
      return { status: 201, body: { id } }
    } catch (e) {
      return respostaDeErro(e, ERROS_PROTESE)
    }
  })
}
