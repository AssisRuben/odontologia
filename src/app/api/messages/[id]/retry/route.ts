import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getCurrentClinic } from '@/lib/auth/currentClinic'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// Recoloca na fila uma mensagem 'failed' da clínica do usuário.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let current
  try {
    current = await getCurrentClinic()
  } catch (e) {
    console.error('[messages/retry] falha ao identificar a clínica:', (e as Error).message)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }
  if (!current) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

  const { id } = await ctx.params
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('messages')
    .update({ status: 'queued', attempts: 0, scheduled_for: new Date().toISOString(), error: null })
    .eq('id', id)
    .eq('clinic_id', current.clinicId)
    .eq('status', 'failed')
    .eq('direction', 'out')
    .select('id')
  if (error) {
    // id que não é UUID (22P02) equivale a "não encontrada"
    if (error.code === '22P02') return NextResponse.json({ error: 'Mensagem não encontrada.' }, { status: 404 })
    console.error('[messages/retry] falha ao reenfileirar:', error.message)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Mensagem não encontrada.' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
