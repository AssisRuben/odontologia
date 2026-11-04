import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createSupabaseIncomingDeps, handleIncoming } from '@/lib/messaging/incoming'
import { getProvider } from '@/lib/whatsapp'

export const maxDuration = 30

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
    const result = await handleIncoming(event, createSupabaseIncomingDeps(), new Date())
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    // 200 mesmo assim: a Evolution não deve reenviar em loop. Nunca logar tokens.
    console.error('[webhook]', err instanceof Error ? err.message : 'erro')
    return NextResponse.json({ ok: false })
  }
}
