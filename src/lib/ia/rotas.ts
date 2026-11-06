import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getCurrentClinic } from '@/lib/auth/currentClinic'
import { createAdminClient } from '@/lib/supabase/admin'
import { AiError, aiErrorResponse } from './erros'

const INTERNAL = { error: 'Erro interno. Tente novamente.' }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(s: unknown): s is string {
  return typeof s === 'string' && UUID_RE.test(s)
}

/** Autentica, entrega clínica/usuário/admin e padroniza 401, 500 e erros de IA. */
export async function withClinic(
  label: string,
  run: (ctx: { clinicId: string; userId: string; admin: SupabaseClient }) => Promise<{ status: number; body: unknown }>,
): Promise<NextResponse> {
  let current
  try {
    current = await getCurrentClinic()
  } catch (e) {
    console.error(`[ia/${label}] falha ao identificar a clínica:`, (e as Error).message)
    return NextResponse.json(INTERNAL, { status: 500 })
  }
  if (!current) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  try {
    const r = await run({ clinicId: current.clinicId, userId: current.userId, admin: createAdminClient() })
    return NextResponse.json(r.body, { status: r.status })
  } catch (e) {
    if (e instanceof AiError) {
      const r = aiErrorResponse(e.kind)
      return NextResponse.json({ error: r.error }, { status: r.status })
    }
    console.error(`[ia/${label}] falha:`, (e as Error).message)
    return NextResponse.json(INTERNAL, { status: 500 })
  }
}
