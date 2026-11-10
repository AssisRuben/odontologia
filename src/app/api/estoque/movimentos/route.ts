import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { todayYmd } from '@/lib/messaging/time'
import { dataValida } from '@/lib/convenios/cadastro'
import { respostaDeErro } from '@/lib/convenios/rotas'
import { createEstoqueRepo } from '@/lib/estoque/repo'
import { ERROS_ESTOQUE } from '@/lib/estoque/rotas'

export const dynamic = 'force-dynamic'

/** Subtrai dias de uma data YYYY-MM-DD com aritmética em UTC (sem fuso). */
function menosDias(ymd: string, dias: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - dias)).toISOString().slice(0, 10)
}

export async function GET(req: NextRequest) {
  return withClinic('estoque movimentos', async ({ clinicId, admin }) => {
    const sp = new URL(req.url).searchParams
    const hoje = todayYmd(new Date(), 'America/Sao_Paulo')
    const de = sp.get('de') || menosDias(hoje, 30)
    const ate = sp.get('ate') || hoje
    if (!dataValida(de) || !dataValida(ate)) return { status: 422, body: { error: 'Data inválida' } }
    const produto = sp.get('produto')
    if (produto && !isUuid(produto)) return { status: 422, body: { error: 'Produto inválido' } }
    const tipo = sp.get('tipo')
    if (tipo && tipo !== 'in' && tipo !== 'out') return { status: 422, body: { error: 'Tipo inválido' } }
    try {
      const itens = await createEstoqueRepo(admin).movimentos(clinicId, {
        de,
        ate,
        produtoId: produto || undefined,
        tipo: tipo === 'in' || tipo === 'out' ? tipo : undefined,
      })
      return { status: 200, body: { itens } }
    } catch (e) {
      return respostaDeErro(e, ERROS_ESTOQUE)
    }
  })
}
