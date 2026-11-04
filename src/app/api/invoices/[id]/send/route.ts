import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getCurrentClinic } from '@/lib/auth/currentClinic'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendInvoiceLink } from '@/lib/payments/notify'

export const dynamic = 'force-dynamic'

// Envia o PDF da nota fiscal ao paciente pelo WhatsApp.
export async function POST(_req: NextRequest, ctx: RouteContext<'/api/invoices/[id]/send'>) {
  let current
  try {
    current = await getCurrentClinic()
  } catch (e) {
    console.error('[invoices/send] falha ao identificar a clínica:', (e as Error).message)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }
  if (!current) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

  try {
    const { id } = await ctx.params
    const result = await sendInvoiceLink(createAdminClient(), current.clinicId, id)
    return NextResponse.json(result.body, { status: result.status })
  } catch (e) {
    console.error('[invoices/send] falha:', (e as Error).message)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }
}
