import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getCurrentClinic } from '@/lib/auth/currentClinic'
import { createAdminClient } from '@/lib/supabase/admin'
import { cancelInvoice } from '@/lib/payments/invoices'
import { createInvoiceDeps } from '@/lib/payments/repo'

export const dynamic = 'force-dynamic'

const INTERNAL = { error: 'Erro interno. Tente novamente.' }

export async function POST(_req: NextRequest, ctx: RouteContext<'/api/invoices/[id]/cancel'>) {
  let current
  try {
    current = await getCurrentClinic()
  } catch (e) {
    console.error('[invoices/cancel] falha ao identificar a clínica:', (e as Error).message)
    return NextResponse.json(INTERNAL, { status: 500 })
  }
  if (!current) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

  try {
    const { id } = await ctx.params
    const result = await cancelInvoice(current.clinicId, id, createInvoiceDeps(createAdminClient()))
    return NextResponse.json(result.body, { status: result.status })
  } catch (e) {
    console.error('[invoices/cancel] falha:', (e as Error).message)
    return NextResponse.json(INTERNAL, { status: 500 })
  }
}
