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
    console.error('[whatsapp/connect] falha ao identificar a clínica:', (e as Error).message)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }
  if (!current) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

  let result
  try {
    result = await getProvider().connect(current.clinicId)
  } catch (e) {
    console.error('[whatsapp/connect] falha no provedor:', (e as Error).message)
    return NextResponse.json(
      { error: 'Não foi possível gerar o QR Code. Tente novamente em instantes.' },
      { status: 502 },
    )
  }

  const connected = result.status === 'connected'
  const status = connected ? 'connected' : 'connecting'
  const { error } = await createAdminClient()
    .from('whatsapp_connections')
    .upsert(
      {
        clinic_id: current.clinicId,
        instance: result.instance,
        token: result.token,
        status,
        ...(connected ? { ever_connected: true } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'clinic_id' },
    )
  if (error) {
    console.error('[whatsapp/connect] falha ao gravar a conexão:', error.message)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }

  return NextResponse.json({ status, qrCode: connected ? null : result.qrCode })
}
