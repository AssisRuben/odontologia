import { NextResponse } from 'next/server'
import { runCycle } from '@/lib/messaging/cycle'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProvider } from '@/lib/whatsapp'
import { expireBudgets } from '@/lib/orcamentos/aprovacao'
import { createApprovalDeps } from '@/lib/orcamentos/repo'
import { authorized } from '@/lib/auth/cronAuth'

export const maxDuration = 60

export async function POST(request: Request) {
  if (!authorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  try {
    const now = new Date()
    const deadline = new Date(now.getTime() + 50_000)
    const admin = createAdminClient()
    try {
      await expireBudgets(now, createApprovalDeps(admin))
    } catch (err) {
      console.error('cron/messages: vencimento de orçamentos falhou:', err instanceof Error ? err.message : err)
    }
    const result = await runCycle(admin, getProvider(), now, deadline)
    return NextResponse.json(result)
  } catch (err) {
    console.error('cron/messages falhou:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
