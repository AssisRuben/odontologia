import { NextResponse } from 'next/server'
import { authorized } from '@/lib/auth/cronAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { reconcileAll } from '@/lib/payments/reconcile'
import { createReconcileDeps } from '@/lib/payments/repo'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
  if (!authorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  try {
    const now = new Date()
    const deadline = new Date(now.getTime() + 50_000)
    const result = await reconcileAll(createReconcileDeps(createAdminClient()), now, deadline)
    return NextResponse.json(result)
  } catch (err) {
    console.error('cron/payments falhou:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
