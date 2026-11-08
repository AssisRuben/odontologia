import { withClinic } from '@/lib/ia/rotas'
import { createConveniosRepo, type ConveniosRepo } from '@/lib/convenios/repo'
import { atrasado, planejarLotes } from '@/lib/convenios/lotes'
import { dataExecucao, itemPronto } from '@/lib/convenios/prontidao'

export const dynamic = 'force-dynamic'

/** Cria os lotes dos períodos necessários e atribui os itens prontos de cada operadora. */
async function montarLotes(clinicId: string, repo: ConveniosRepo) {
  const operadoras = (await repo.operadoras(clinicId)).filter((o) => o.active && o.closing_day !== null)
  if (operadoras.length === 0) return
  const prontos = (await repo.itensSemLote(clinicId))
    .filter((i) => itemPronto(i, i.treatment))
    .flatMap((i) => {
      const execucao = dataExecucao(i, i.treatment)
      return execucao ? [{ id: i.id, plan_id: i.plan_id, execucao, defer_until: i.defer_until }] : []
    })

  for (const o of operadoras) {
    const itens = prontos.filter((i) => i.plan_id === o.id)
    if (itens.length === 0) continue
    const plano = planejarLotes({
      closingDay: o.closing_day as number,
      submissionDays: o.submission_days,
      itens,
      lotes: await repo.lotes(clinicId, o.id),
    })
    await repo.criarLotes(clinicId, o.id, plano.criar)

    const lotes = await repo.lotes(clinicId, o.id)
    const idPorPeriodo = new Map(lotes.filter((l) => l.status === 'aberto').map((l) => [l.period_end, l.id]))
    const porLote = new Map<string, string[]>()
    for (const a of plano.atribuir) {
      const batchId = idPorPeriodo.get(a.period_end)
      if (batchId) porLote.set(batchId, [...(porLote.get(batchId) ?? []), a.itemId])
    }
    for (const [batchId, itemIds] of porLote) {
      try {
        await repo.atribuir(clinicId, batchId, itemIds)
      } catch (e) {
        // Lote enviado entre a leitura e a atribuição: os itens ficam para a próxima chamada.
        if ((e as { message?: string })?.message !== 'LOTE_ENVIADO') throw e
      }
    }
  }
}

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
