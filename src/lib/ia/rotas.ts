import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getCurrentClinic } from '@/lib/auth/currentClinic'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUuid } from './uuid'
import { AiError, aiErrorResponse } from './erros'

const INTERNAL = { error: 'Erro interno. Tente novamente.' }

export { isUuid }

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
