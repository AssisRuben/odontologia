import { timingSafeEqual } from 'node:crypto'
import { after, NextResponse } from 'next/server'
import { runAgent } from '@/lib/agente/agente'
import { createAgentDeps } from '@/lib/agente/repo'
import { createAdminClient } from '@/lib/supabase/admin'
import { createSupabaseIncomingDeps, handleIncoming } from '@/lib/messaging/incoming'
import { getProvider } from '@/lib/whatsapp'

export const maxDuration = 60

function tokenValid(received: string | null): boolean {
  const secret = process.env.EVOLUTION_WEBHOOK_TOKEN
  if (!secret || !received) return false
  const a = Buffer.from(received)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  if (!tokenValid(new URL(request.url).searchParams.get('token'))) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ ignored: true })
    }
    const event = getProvider().parseWebhook(body)
    if (!event) return NextResponse.json({ ignored: true })
    const admin = createAdminClient()
    const { result, agent } = await handleIncoming(event, createSupabaseIncomingDeps(admin), new Date())
    if (agent) {
      after(() =>
        runAgent(createAgentDeps(admin), agent.conversationId, agent.messageId, () => new Date()).catch((e) =>
          console.error('[agente]', e instanceof Error ? e.message : 'erro'),
        ),
      )
    }
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    // 200 mesmo assim: a Evolution não deve reenviar em loop. Nunca logar tokens.
    console.error('[webhook]', err instanceof Error ? err.message : 'erro')
    return NextResponse.json({ ok: false })
  }
}
