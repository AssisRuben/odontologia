import type { NextRequest } from 'next/server'
import { withClinic } from '@/lib/ia/rotas'
import { createConveniosRepo } from '@/lib/convenios/repo'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? ''
  return withClinic('convenios motivos GET', async ({ admin }) => {
    return { status: 200, body: { motivos: await createConveniosRepo(admin).buscarMotivos(q) } }
  })
}
