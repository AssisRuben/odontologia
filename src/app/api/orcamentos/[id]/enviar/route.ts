import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getCurrentClinic } from '@/lib/auth/currentClinic'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendBudget } from '@/lib/orcamentos/envio'
import { createSendDeps } from '@/lib/orcamentos/repo'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: RouteContext<'/api/orcamentos/[id]/enviar'>) {
  let current
  try {
    current = await getCurrentClinic()
  } catch (e) {
    console.error('[orcamentos/enviar] falha ao identificar a clínica:', (e as Error).message)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }
  if (!current) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

  try {
    const { id } = await ctx.params
    const body = (await req.json().catch(() => null)) as { resend?: unknown } | null
    const result = await sendBudget(
      { budgetId: id, clinicId: current.clinicId, actorId: current.userId, resend: body?.resend === true },
      createSendDeps(createAdminClient()),
    )
    return NextResponse.json(result.body, { status: result.status })
  } catch (e) {
    console.error('[orcamentos/enviar] falha:', (e as Error).message)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }
}
