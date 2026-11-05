import { NextResponse } from 'next/server'
import { getCurrentClinic } from '@/lib/auth/currentClinic'
import { createClient } from '@/lib/supabase/server'
import { markReceipt, unmarkReceipt } from '@/lib/livro-caixa/recibos'
import { createReceiptDeps } from '@/lib/livro-caixa/repo'

export const dynamic = 'force-dynamic'

const INTERNAL = { error: 'Erro interno. Tente novamente.' }

async function handle(
  ctx: RouteContext<'/api/livro-caixa/recibos/[paymentId]'>,
  action: 'mark' | 'unmark',
) {
  try {
    const current = await getCurrentClinic()
    if (!current) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
    const { paymentId } = await ctx.params
    const deps = createReceiptDeps(await createClient())
    const result =
      action === 'mark'
        ? await markReceipt(current.clinicId, current.userId, paymentId, deps)
        : await unmarkReceipt(current.clinicId, paymentId, deps)
    return NextResponse.json(result.body, { status: result.status })
  } catch (e) {
    console.error('[livro-caixa/recibos] falha:', (e as Error).message)
    return NextResponse.json(INTERNAL, { status: 500 })
  }
}

export async function POST(_req: Request, ctx: RouteContext<'/api/livro-caixa/recibos/[paymentId]'>) {
  return handle(ctx, 'mark')
}

export async function DELETE(_req: Request, ctx: RouteContext<'/api/livro-caixa/recibos/[paymentId]'>) {
  return handle(ctx, 'unmark')
}
