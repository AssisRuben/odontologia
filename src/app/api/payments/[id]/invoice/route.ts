import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getCurrentClinic } from '@/lib/auth/currentClinic'
import { createAdminClient } from '@/lib/supabase/admin'
import { scheduleInvoiceForPayment } from '@/lib/payments/invoices'
import { createInvoiceDeps } from '@/lib/payments/repo'

export const dynamic = 'force-dynamic'

const INTERNAL = { error: 'Erro interno. Tente novamente.' }

export async function POST(req: NextRequest, ctx: RouteContext<'/api/payments/[id]/invoice'>) {
  let current
  try {
    current = await getCurrentClinic()
  } catch (e) {
    console.error('[payments/invoice] falha ao identificar a clínica:', (e as Error).message)
    return NextResponse.json(INTERNAL, { status: 500 })
  }
  if (!current) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

  let j: Record<string, unknown> = {}
  try {
    const parsed = await req.json()
    if (parsed && typeof parsed === 'object') j = parsed as Record<string, unknown>
  } catch {
    // corpo vazio ou inválido: usa os padrões
  }
  if (j.description !== undefined && typeof j.description !== 'string') {
    return NextResponse.json({ error: 'Descrição inválida' }, { status: 422 })
  }
  if (j.valueCents !== undefined && typeof j.valueCents !== 'number') {
    return NextResponse.json({ error: 'Valor inválido' }, { status: 422 })
  }

  try {
    const { id } = await ctx.params
    const result = await scheduleInvoiceForPayment(
      current.clinicId,
      id,
      { description: j.description as string | undefined, valueCents: j.valueCents as number | undefined },
      createInvoiceDeps(createAdminClient()),
    )
    return NextResponse.json(result.body, { status: result.status })
  } catch (e) {
    console.error('[payments/invoice] falha:', (e as Error).message)
    return NextResponse.json(INTERNAL, { status: 500 })
  }
}
