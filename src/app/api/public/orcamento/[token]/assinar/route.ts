import { createAdminClient } from '@/lib/supabase/admin'
import { createPublicDeps, createApprovalDeps } from '@/lib/orcamentos/repo'
import { signPublic, clientIp } from '@/lib/orcamentos/publico'
import { publicJson, INTERNAL_ERROR } from '@/lib/orcamentos/publicoHttp'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: RouteContext<'/api/public/orcamento/[token]/assinar'>) {
  try {
    const { token } = await ctx.params
    const raw = await req.json().catch(() => null)
    const admin = createAdminClient()
    const r = await signPublic(
      token,
      raw,
      { ip: clientIp(req.headers.get('x-forwarded-for')), userAgent: req.headers.get('user-agent'), now: new Date() },
      { ...createPublicDeps(admin), ...createApprovalDeps(admin) },
    )
    return publicJson(r.body, r.status)
  } catch (e) {
    console.error('[public/orcamento/assinar] falha:', (e as Error).message)
    return publicJson({ error: INTERNAL_ERROR }, 500)
  }
}
