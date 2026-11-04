import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getCurrentClinic } from '@/lib/auth/currentClinic'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  buildConnectionResponse, connect, disconnect, updateSettings, type SettingsPatch,
} from '@/lib/payments/connection'
import { createSupabaseConnectionDeps, getPublicConnection } from '@/lib/payments/repo'

export const dynamic = 'force-dynamic'

const INTERNAL = { error: 'Erro interno. Tente novamente.' }
const SETTINGS_KEYS = [
  'fine_percent', 'interest_percent_month', 'nfse_auto', 'nfse_description', 'nfse_service_code', 'nfse_iss_rate',
] as const

async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const j = await req.json()
    return j && typeof j === 'object' ? (j as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

async function handle(
  label: string,
  run: (clinicId: string, admin: ReturnType<typeof createAdminClient>) => Promise<{ status: number; body: unknown }>,
) {
  let current
  try {
    current = await getCurrentClinic()
  } catch (e) {
    console.error(`[payments/connection ${label}] falha ao identificar a clínica:`, (e as Error).message)
    return NextResponse.json(INTERNAL, { status: 500 })
  }
  if (!current) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  try {
    const r = await run(current.clinicId, createAdminClient())
    return NextResponse.json(r.body, { status: r.status })
  } catch (e) {
    console.error(`[payments/connection ${label}] falha:`, (e as Error).message)
    return NextResponse.json(INTERNAL, { status: 500 })
  }
}

export async function GET() {
  return handle('GET', async (clinicId, admin) => {
    const row = await getPublicConnection(admin, clinicId)
    // fiscal (getFiscalStatus) entra na Task 10
    return { status: 200, body: buildConnectionResponse(row, null) }
  })
}

export async function POST(req: NextRequest) {
  const json = await readJson(req)
  return handle('POST', async (clinicId, admin) => {
    const r = await connect(
      { clinicId, apiKey: json.apiKey as string, environment: json.environment as 'sandbox' | 'production' },
      createSupabaseConnectionDeps(admin),
    )
    return r.ok
      ? { status: 200, body: { ok: true, accountName: r.accountName } }
      : { status: r.status, body: { error: r.error } }
  })
}

export async function PATCH(req: NextRequest) {
  const json = await readJson(req)
  const patch: Record<string, unknown> = {}
  for (const k of SETTINGS_KEYS) if (k in json) patch[k] = json[k]
  return handle('PATCH', async (clinicId, admin) => {
    const r = await updateSettings(clinicId, patch as SettingsPatch, createSupabaseConnectionDeps(admin))
    return r.ok ? { status: 200, body: { ok: true } } : { status: r.status, body: { error: r.error } }
  })
}

export async function DELETE() {
  return handle('DELETE', async (clinicId, admin) => {
    await disconnect(clinicId, createSupabaseConnectionDeps(admin))
    return { status: 200, body: { ok: true } }
  })
}
