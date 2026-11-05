import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { handleWebhook } from '@/lib/payments/events'
import { createEventDeps, createWebhookInvoiceScheduler } from '@/lib/payments/repo'

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
    const admin = createAdminClient()
    const deps = createEventDeps(admin, createWebhookInvoiceScheduler(admin))
    const r = await handleWebhook(token, body, deps, new Date())
    if (r.status === 401) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    if (r.status === 500) return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    return NextResponse.json({ result: r.result })
  } catch (e) {
    console.error('[webhooks/asaas] falha:', (e as Error).message)
    // Antes de o evento ser gravado, 500 faz o Asaas tentar de novo.
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
