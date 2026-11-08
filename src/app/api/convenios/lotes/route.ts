import { withClinic } from '@/lib/ia/rotas'
import { createConveniosRepo } from '@/lib/convenios/repo'
import { atrasado } from '@/lib/convenios/lotes'
import { montarLotes } from '@/lib/convenios/montagem'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withClinic('convenios lotes GET', async ({ clinicId, admin }) => {
    const repo = createConveniosRepo(admin)
    await montarLotes(clinicId, repo)
    const lotes = (await repo.lotesComItens(clinicId)).sort((a, b) => a.due_date.localeCompare(b.due_date))
    return {
      status: 200,
      body: {
        lotes: lotes.map((l) => ({
          id: l.id,
          plan: l.plan,
          period_start: l.period_start,
          period_end: l.period_end,
          due_date: l.due_date,
          status: l.status,
          protocol: l.protocol,
          sent_at: l.sent_at,
          total: l.total,
          itens: l.itens.map((i) => ({
            ...i,
            atrasado: i.executed_at ? atrasado(i.executed_at, l.period_start) : false,
          })),
        })),
      },
    }
  })
}
