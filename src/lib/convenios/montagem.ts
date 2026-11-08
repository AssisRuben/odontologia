import type { ConveniosRepo } from './repo'
import { planejarLotes } from './lotes'
import { dataExecucao, itemPronto } from './prontidao'

/**
 * Cria os lotes dos períodos necessários e atribui os itens prontos de cada
 * operadora com dia de fechamento (ativa ou não: itens já executados de uma
 * operadora desativada ainda precisam ser cobrados). Idempotente.
 */
export async function montarLotes(clinicId: string, repo: ConveniosRepo): Promise<void> {
  const operadoras = (await repo.operadoras(clinicId)).filter((o) => o.closing_day !== null)
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
