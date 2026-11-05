import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getCurrentClinic } from '@/lib/auth/currentClinic'
import { createAdminClient } from '@/lib/supabase/admin'
import { todayYmd } from '@/lib/messaging/time'
import { buildFunnel } from '@/lib/orcamentos/funil'
import { needsCall } from '@/lib/orcamentos/paraLigar'
import { parseFunnelQuery } from '@/lib/orcamentos/rotas'
import { BUDGET_TZ } from '@/lib/orcamentos/aprovacao'
import { loadFunnelSources, loadReminderSettings } from '@/lib/orcamentos/repo'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  let current
  try {
    current = await getCurrentClinic()
  } catch (e) {
    console.error('[orcamentos/funil] falha ao identificar a clínica:', (e as Error).message)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }
  if (!current) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

  const q = parseFunnelQuery(req.nextUrl.searchParams)
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: q.status })

  try {
    const admin = createAdminClient()
    const [sources, settings, profs] = await Promise.all([
      loadFunnelSources(admin, current.clinicId),
      loadReminderSettings(admin, current.clinicId),
      admin.from('professionals').select('id, name').eq('clinic_id', current.clinicId).order('name'),
    ])
    if (profs.error) throw new Error(profs.error.message)

    const scoped = sources.filter((s) => q.professionalId === undefined || s.professional_id === q.professionalId)
    const now = new Date()
    const inPeriod = (iso: string | null) => {
      if (!iso) return false
      const d = todayYmd(new Date(iso), BUDGET_TZ)
      return d >= q.from && d <= q.to
    }
    const sent = scoped.filter((s) => s.status === 'sent')
    const funnel = buildFunnel(sources, { from: q.from, to: q.to, professionalId: q.professionalId })
    const decided = (st: string[]) => scoped.filter((s) => st.includes(s.status) && inPeriod(s.decided_at)).map((s) => s.list)

    return NextResponse.json({
      funnel,
      tabs: {
        enviados: sent.map((s) => s.list),
        paraLigar: sent.filter((s) => needsCall(s, now, settings.tz, settings.reminderDays)).map((s) => s.list),
        aprovados: decided(['approved', 'completed']),
        perdidos: decided(['rejected', 'expired']),
      },
      professionals: profs.data ?? [],
    })
  } catch (e) {
    console.error('[orcamentos/funil] falha:', (e as Error).message)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }
}
