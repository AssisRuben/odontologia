import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getCurrentClinic } from '@/lib/auth/currentClinic'
import { createAdminClient } from '@/lib/supabase/admin'
import { linkUrl } from '@/lib/orcamentos/links'
import { createSendDeps } from '@/lib/orcamentos/repo'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/orcamentos/[id]/link'>) {
  let current
  try {
    current = await getCurrentClinic()
  } catch (e) {
    console.error('[orcamentos/link] falha ao identificar a clínica:', (e as Error).message)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }
  if (!current) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

  try {
    const { id } = await ctx.params
    const active = await createSendDeps(createAdminClient()).getActiveLink(id, current.clinicId)
    if (!active) return NextResponse.json({ error: 'Este orçamento não tem link ativo' }, { status: 404 })
    return NextResponse.json({ link: linkUrl(active.token) })
  } catch (e) {
    console.error('[orcamentos/link] falha:', (e as Error).message)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }
}
