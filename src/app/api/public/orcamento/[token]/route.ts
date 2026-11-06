import { createAdminClient } from '@/lib/supabase/admin'
import { createPublicDeps } from '@/lib/orcamentos/repo'
import { publicView } from '@/lib/orcamentos/publico'
import { publicJson, INTERNAL_ERROR } from '@/lib/orcamentos/publicoHttp'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: RouteContext<'/api/public/orcamento/[token]'>) {
  try {
    const { token } = await ctx.params
    return publicJson(await publicView(token, new Date(), createPublicDeps(createAdminClient())))
  } catch (e) {
    console.error('[public/orcamento] falha:', (e as Error).message)
    return publicJson({ error: INTERNAL_ERROR }, 500)
  }
}
