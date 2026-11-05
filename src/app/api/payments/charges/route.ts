import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getCurrentClinic } from '@/lib/auth/currentClinic'
import { createAdminClient } from '@/lib/supabase/admin'
import { createCharge, type CreateChargeInput } from '@/lib/payments/charges'
import { createChargeDeps } from '@/lib/payments/repo'

export const dynamic = 'force-dynamic'

const INTERNAL = { error: 'Erro interno. Tente novamente.' }

export async function POST(req: NextRequest) {
  let current
  try {
    current = await getCurrentClinic()
  } catch (e) {
    console.error('[payments/charges] falha ao identificar a clínica:', (e as Error).message)
    return NextResponse.json(INTERNAL, { status: 500 })
  }
  if (!current) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

  let j: Record<string, unknown> = {}
  try {
    const parsed = await req.json()
    if (parsed && typeof parsed === 'object') j = parsed as Record<string, unknown>
  } catch {
    // corpo inválido cai na validação (422)
  }

  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const input: CreateChargeInput = {
    clinicId: current.clinicId,
    patientId: str(j.patientId),
    budgetId: str(j.budgetId) || null,
    amountCents: typeof j.amountCents === 'number' ? j.amountCents : NaN,
    description: str(j.description),
    kind: str(j.kind) as CreateChargeInput['kind'],
    installmentCount: typeof j.installmentCount === 'number' ? j.installmentCount : 1,
    firstDueDate: str(j.firstDueDate),
    cpf: str(j.cpf) || null,
    sendWhatsApp: j.sendWhatsApp === true,
  }

  try {
    const result = await createCharge(input, createChargeDeps(createAdminClient()), new Date())
    return NextResponse.json(result.body, { status: result.status })
  } catch (e) {
    console.error('[payments/charges] falha:', (e as Error).message)
    return NextResponse.json(INTERNAL, { status: 500 })
  }
}
