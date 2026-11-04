import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { handleWebhook } from '@/lib/payments/events'
import { createEventDeps } from '@/lib/payments/repo'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(request: Request) {
  const token = request.headers.get('asaas-access-token')
  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = undefined
  }
  try {
    // A emissão de NFS-e (Task 10) ainda não existe: o evento fica 'failed' e é reprocessado depois.
    const deps = createEventDeps(createAdminClient(), async () => {
      throw new Error('NFS-e indisponível')
    })
    const r = await handleWebhook(token, body, deps, new Date())
    if (r.status === 401) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    return NextResponse.json({ result: r.result })
  } catch (e) {
    console.error('[webhooks/asaas] falha:', (e as Error).message)
    return NextResponse.json({ result: 'failed' })
  }
}
