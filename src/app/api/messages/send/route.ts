import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getCurrentClinic } from '@/lib/auth/currentClinic'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendManual } from '@/lib/messaging/manual'
import { createManualDeps } from '@/lib/messaging/manualDeps'

export const dynamic = 'force-dynamic'

// Envio manual a um paciente (ignora a janela de horário; respeita opt-out e limite diário).
export async function POST(req: NextRequest) {
  let current
  try {
    current = await getCurrentClinic()
  } catch (e) {
    console.error('[messages/send] falha ao identificar a clínica:', (e as Error).message)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }
  if (!current) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

  let json: { patient_id?: unknown; body?: unknown } | null = null
  try {
    json = await req.json()
  } catch {
    // corpo inválido cai na validação (422)
  }

  const deps = createManualDeps(createAdminClient())

  try {
    const result = await sendManual(
      { clinicId: current.clinicId, patient_id: json?.patient_id, body: json?.body },
      deps,
    )
    return NextResponse.json(result.body, { status: result.status })
  } catch (e) {
    console.error('[messages/send] falha:', (e as Error).message)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }
}
