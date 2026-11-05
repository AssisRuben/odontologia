import { NextResponse } from 'next/server'
import { getCurrentClinic } from '@/lib/auth/currentClinic'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProvider, type ConnectionStatus } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

export async function GET() {
  let current
  try {
    current = await getCurrentClinic()
  } catch (e) {
    console.error('[whatsapp/status] falha ao identificar a clínica:', (e as Error).message)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }
  if (!current) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

  const admin = createAdminClient()
  const { data: row, error } = await admin
    .from('whatsapp_connections')
    .select('instance, token, status, phone, ever_connected')
    .eq('clinic_id', current.clinicId)
    .maybeSingle()
  if (error) {
    console.error('[whatsapp/status] falha ao ler a conexão:', error.message)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }
  if (!row) return NextResponse.json({ status: 'disconnected', phone: null, everConnected: false })

  let status = row.status as ConnectionStatus
  let phone = (row.phone as string | null) ?? null
  let everConnected = Boolean(row.ever_connected)

  try {
    const polled = await getProvider().getStatus(row.instance as string, row.token as string)
    // A Evolution reporta 'close' para QR não lido/expirado: não rebaixa 'connecting' só pelo polling.
    const live = status === 'connecting' && polled.status === 'disconnected'
      ? { ...polled, status: 'connecting' as ConnectionStatus }
      : polled
    const newPhone = live.phone ?? phone
    if (live.status !== status || newPhone !== phone) {
      const update: Record<string, unknown> = { status: live.status, updated_at: new Date().toISOString() }
      if (live.phone) update.phone = live.phone
      if (live.status === 'connected') update.ever_connected = true
      const { error: upErr } = await admin
        .from('whatsapp_connections')
        .update(update)
        .eq('clinic_id', current.clinicId)
      if (upErr) {
        console.error('[whatsapp/status] falha ao atualizar a conexão:', upErr.message)
      } else {
        status = live.status
        phone = newPhone
        if (live.status === 'connected') everConnected = true
      }
    }
  } catch (e) {
    console.error('[whatsapp/status] provedor indisponível, usando valores salvos:', (e as Error).message)
  }

  return NextResponse.json({ status, phone, everConnected })
}
