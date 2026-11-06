import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getCurrentClinic } from '@/lib/auth/currentClinic'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildReceiptPdf } from '@/lib/orcamentos/comprovante'
import { loadSignature } from '@/lib/orcamentos/repo'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/orcamentos/[id]/comprovante'>) {
  let current
  try {
    current = await getCurrentClinic()
  } catch (e) {
    console.error('[orcamentos/comprovante] falha ao identificar a clínica:', (e as Error).message)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }
  if (!current) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

  try {
    const { id } = await ctx.params
    const sig = await loadSignature(createAdminClient(), id, current.clinicId)
    if (!sig) return NextResponse.json({ error: 'Comprovante não encontrado' }, { status: 404 })
    const pdf = await buildReceiptPdf(sig.snapshot, {
      hash: sig.document_hash, ip: sig.ip, userAgent: sig.user_agent, provider: sig.provider,
    })
    return new Response(pdf as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="comprovante-orcamento-${id.slice(0, 8).toUpperCase()}.pdf"`,
      },
    })
  } catch (e) {
    console.error('[orcamentos/comprovante] falha:', (e as Error).message)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }
}
