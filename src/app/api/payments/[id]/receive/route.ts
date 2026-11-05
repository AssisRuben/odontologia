import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getCurrentClinic } from '@/lib/auth/currentClinic'
import { createAdminClient } from '@/lib/supabase/admin'
import { markReceived } from '@/lib/payments/actions'
import type { PaymentMethod } from '@/types'
import { createActionDeps } from '@/lib/payments/repo'

export const dynamic = 'force-dynamic'

const INTERNAL = { error: 'Erro interno. Tente novamente.' }

export async function POST(req: NextRequest, ctx: RouteContext<'/api/payments/[id]/receive'>) {
  let current
  try {
    current = await getCurrentClinic()
  } catch (e) {
    console.error('[payments/receive] falha ao identificar a clínica:', (e as Error).message)
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
    const methods = ['dinheiro', 'cartao_credito', 'cartao_debito', 'pix', 'boleto', 'convenio']
    if (j.method !== undefined && j.method !== null && !(typeof j.method === 'string' && methods.includes(j.method))) {
      return NextResponse.json({ error: 'Forma de pagamento inválida' }, { status: 422 })
    }
    const method = typeof j.method === 'string' ? (j.method as PaymentMethod) : undefined
    const result = await markReceived(
      current.clinicId,
      id,
      {
        paidAt: typeof j.paidAt === 'string' ? j.paidAt : '',
        amountCents: typeof j.amountCents === 'number' ? j.amountCents : NaN,
        method,
      },
      deps,
    )
    return NextResponse.json(result.body, { status: result.status })
  } catch (e) {
    console.error('[payments/receive] falha:', (e as Error).message)
    return NextResponse.json(INTERNAL, { status: 500 })
  }
}
