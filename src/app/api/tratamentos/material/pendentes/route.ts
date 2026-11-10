import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { createKitsRepo } from '@/lib/kits/repo'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const paciente = req.nextUrl.searchParams.get('paciente')
  return withClinic('tratamentos pendentes', async ({ clinicId, admin }) => {
    if (!paciente || !isUuid(paciente)) return { status: 422, body: { error: 'Paciente inválido' } }
    return { status: 200, body: { ids: await createKitsRepo(admin).pendentes(clinicId, paciente) } }
  })
}
