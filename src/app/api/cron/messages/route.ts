import { NextResponse } from 'next/server'
import { runCycle } from '@/lib/messaging/cycle'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProvider } from '@/lib/whatsapp'
import { authorized } from '@/lib/auth/cronAuth'

export const maxDuration = 60

export async function POST(request: Request) {
  if (!authorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  try {
    const now = new Date()
    const deadline = new Date(now.getTime() + 50_000)
    const result = await runCycle(createAdminClient(), getProvider(), now, deadline)
    return NextResponse.json(result)
  } catch (err) {
    console.error('cron/messages falhou:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
