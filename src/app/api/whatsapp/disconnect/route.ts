import { NextResponse } from 'next/server'
import { getCurrentClinic } from '@/lib/auth/currentClinic'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProvider } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

export async function POST() {
  let current
  try {
    current = await getCurrentClinic()
  } catch (e) {
    console.error('[whatsapp/disconnect] falha ao identificar a clínica:', (e as Error).message)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }
  if (!current) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

  const admin = createAdminClient()
  const { data: row, error } = await admin
    .from('whatsapp_connections')
    .select('instance, token')
    .eq('clinic_id', current.clinicId)
    .maybeSingle()
  if (error) {
    console.error('[whatsapp/disconnect] falha ao ler a conexão:', error.message)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }
  if (!row) return NextResponse.json({ status: 'disconnected' })

  try {
    await getProvider().disconnect(row.instance as string, row.token as string)
  } catch (e) {
    console.error('[whatsapp/disconnect] falha no provedor:', (e as Error).message)
    return NextResponse.json(
      { error: 'Não foi possível desconectar agora. Tente novamente em instantes.' },
      { status: 502 },
    )
  }

  const { error: upErr } = await admin
    .from('whatsapp_connections')
    .update({ status: 'disconnected', updated_at: new Date().toISOString() })
    .eq('clinic_id', current.clinicId)
  if (upErr) {
    console.error('[whatsapp/disconnect] falha ao atualizar a conexão:', upErr.message)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }
  return NextResponse.json({ status: 'disconnected' })
}
