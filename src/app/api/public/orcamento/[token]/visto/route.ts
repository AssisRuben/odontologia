import { createAdminClient } from '@/lib/supabase/admin'
import { createPublicDeps } from '@/lib/orcamentos/repo'
import { recordView } from '@/lib/orcamentos/publico'
import { PUBLIC_HEADERS } from '@/lib/orcamentos/publicoHttp'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, ctx: RouteContext<'/api/public/orcamento/[token]/visto'>) {
  try {
    const { token } = await ctx.params
    await recordView(token, new Date(), createPublicDeps(createAdminClient()))
  } catch (e) {
    console.error('[public/orcamento/visto] falha:', (e as Error).message)
  }
  return new Response(null, { status: 204, headers: PUBLIC_HEADERS })
}
