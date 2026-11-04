import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getCurrentClinic } from '@/lib/auth/currentClinic'
import { createAdminClient } from '@/lib/supabase/admin'
import { cancelPayment } from '@/lib/payments/actions'
import { createActionDeps } from '@/lib/payments/repo'

export const dynamic = 'force-dynamic'

const INTERNAL = { error: 'Erro interno. Tente novamente.' }

export async function POST(req: NextRequest, ctx: RouteContext<'/api/payments/[id]/cancel'>) {
  let current
  try {
    current = await getCurrentClinic()
  } catch (e) {
    console.error('[payments/cancel] falha ao identificar a clínica:', (e as Error).message)
    return NextResponse.json(INTERNAL, { status: 500 })
  }
  if (!current) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

  let j: Record<string, unknown> = {}
  try {
    const parsed = await req.json()
    if (parsed && typeof parsed === 'object') j = parsed as Record<string, unknown>
  } catch {
    // corpo inválido cai na validação (422)
  }

  try {
    const { id } = await ctx.params
    const deps = createActionDeps(createAdminClient())
    const result = await cancelPayment(current.clinicId, id, j.scope === 'remaining' ? 'remaining' : 'one', deps)
    return NextResponse.json(result.body, { status: result.status })
  } catch (e) {
    console.error('[payments/cancel] falha:', (e as Error).message)
    return NextResponse.json(INTERNAL, { status: 500 })
  }
}
