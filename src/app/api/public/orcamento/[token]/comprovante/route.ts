import { createAdminClient } from '@/lib/supabase/admin'
import { createPublicDeps, loadSignature } from '@/lib/orcamentos/repo'
import { resolveLink } from '@/lib/orcamentos/links'
import { receiptAvailable } from '@/lib/orcamentos/publico'
import { buildReceiptPdf } from '@/lib/orcamentos/comprovante'
import { PUBLIC_HEADERS, publicJson, INTERNAL_ERROR } from '@/lib/orcamentos/publicoHttp'

export const dynamic = 'force-dynamic'

const NOT_FOUND = 'Comprovante não encontrado'

export async function GET(_req: Request, ctx: RouteContext<'/api/public/orcamento/[token]/comprovante'>) {
  try {
    const { token } = await ctx.params
    const admin = createAdminClient()
    const now = new Date()
    const view = await resolveLink(token, createPublicDeps(admin), now)
    if (!view || !receiptAvailable(view, now)) {
      return publicJson({ error: NOT_FOUND }, 404)
    }
    const sig = await loadSignature(admin, view.budgetId, view.clinicId)
    if (!sig) return publicJson({ error: NOT_FOUND }, 404)
    const pdf = await buildReceiptPdf(sig.snapshot, {
      hash: sig.document_hash, ip: sig.ip, userAgent: sig.user_agent, provider: sig.provider, maskCpf: true,
    })
    return new Response(pdf as BodyInit, {
      status: 200,
      headers: {
        ...PUBLIC_HEADERS,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="comprovante-orcamento-${view.budgetId.slice(0, 8).toUpperCase()}.pdf"`,
      },
    })
  } catch (e) {
    console.error('[public/orcamento/comprovante] falha:', (e as Error).message)
    return publicJson({ error: INTERNAL_ERROR }, 500)
  }
}
