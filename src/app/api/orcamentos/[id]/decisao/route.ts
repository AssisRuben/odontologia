import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getCurrentClinic } from '@/lib/auth/currentClinic'
import { createAdminClient } from '@/lib/supabase/admin'
import { approveBudget, rejectBudget } from '@/lib/orcamentos/aprovacao'
import { canDecideByReception, canReopen } from '@/lib/orcamentos/etapas'
import { parseDecision } from '@/lib/orcamentos/rotas'
import { createApprovalDeps } from '@/lib/orcamentos/repo'
import type { BudgetStatus } from '@/types'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: RouteContext<'/api/orcamentos/[id]/decisao'>) {
  let current
  try {
    current = await getCurrentClinic()
  } catch (e) {
    console.error('[orcamentos/decisao] falha ao identificar a clínica:', (e as Error).message)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }
  if (!current) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

  const parsed = parseDecision(await req.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status })
  const d = parsed.decision

  try {
    const { id } = await ctx.params
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('budgets')
      .select('status')
      .eq('id', id)
      .eq('clinic_id', current.clinicId)
      .maybeSingle()
    if (error && error.code !== '22P02') throw new Error(error.message)
    if (!data) return NextResponse.json({ error: 'Orçamento não encontrado' }, { status: 404 })
    const status = (data as { status: BudgetStatus }).status

    if (d.action === 'reopen') {
      if (!canReopen(status)) {
        return NextResponse.json({ error: 'Só orçamentos perdidos podem ser reabertos' }, { status: 422 })
      }
      const up = await admin
        .from('budgets')
        .update({ status: 'draft', decided_at: null, lost_reason: null, followup_at: null })
        .eq('id', id)
        .eq('clinic_id', current.clinicId)
      if (up.error) throw new Error(up.error.message)
      const ev = await admin
        .from('budget_events')
        .insert({ budget_id: id, clinic_id: current.clinicId, type: 'reopened', created_by: current.userId })
      if (ev.error) throw new Error(ev.error.message)
      return NextResponse.json({ ok: true })
    }

    if (!canDecideByReception(status)) {
      return NextResponse.json({ error: 'Este orçamento não pode mais ser decidido' }, { status: 422 })
    }
    const deps = createApprovalDeps(admin)
    const result =
      d.action === 'approve'
        ? await approveBudget(
            { budgetId: id, clinicId: current.clinicId, linkId: null, itemIds: d.itemIds, signer: null,
              actorId: current.userId, ip: null, userAgent: null, now: new Date() },
            deps,
          )
        : await rejectBudget(
            { budgetId: id, clinicId: current.clinicId, linkId: null, reason: d.reason, note: d.note,
              actorId: current.userId, status: 'rejected' },
            deps,
          )
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[orcamentos/decisao] falha:', (e as Error).message)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }
}
