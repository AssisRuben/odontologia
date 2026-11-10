// Textos das respostas de erro das rotas de kits e da baixa por tratamento.

import { respostaDeErro, type Mapa } from '@/lib/convenios/rotas'

export const ERROS_KITS: Mapa = {
  KIT_NAO_ENCONTRADO: { status: 404, error: 'Kit não encontrado' },
  KIT_VAZIO: { status: 422, error: 'Inclua ao menos um produto' },
  ITEM_REPETIDO: { status: 422, error: 'Produto repetido na lista' },
  QUANTIDADE_INVALIDA: { status: 422, error: 'Quantidade inválida' },
  PRODUTO_INVALIDO: { status: 422, error: 'Produto inválido' },
  TRATAMENTO_NAO_ENCONTRADO: { status: 404, error: 'Tratamento não encontrado' },
  TRATAMENTO_NAO_CONCLUIDO: { status: 409, error: 'O tratamento não está concluído' },
  MATERIAL_JA_RESOLVIDO: { status: 409, error: 'A baixa deste tratamento já foi resolvida' },
  MATERIAL_NAO_BAIXADO: { status: 409, error: 'Este tratamento não tem baixa para devolver' },
  '23505': { status: 409, error: 'Já existe um kit com esse nome' },
}

/** Mensagens do banco no formato CODIGO:uuid-do-produto. */
export function separarItem(message?: string): { codigo: string; itemId: string } | null {
  const m = /^([A-Z_]+):([0-9a-f-]{36})$/.exec(message ?? '')
  return m ? { codigo: m[1], itemId: m[2] } : null
}

/** Erro que cita o produto pelo nome; null se o código não for deste tipo. */
export function erroComItem(codigo: string, nome: string | null): { status: number; error: string } | null {
  switch (codigo) {
    case 'ESTOQUE_INSUFICIENTE':
      return { status: 409, error: `Saldo insuficiente de ${nome ?? 'um produto'}` }
    case 'PRODUTO_INATIVO':
      return { status: 409, error: nome ? `${nome} está inativo` : 'Um produto está inativo' }
    case 'PRODUTO_NAO_ENCONTRADO':
      return { status: 422, error: 'Produto não encontrado' }
    default:
      return null
  }
}

/**
 * Resposta de erro das rotas de kits: erros no formato CODIGO:uuid-do-produto citam
 * o produto pelo nome; os demais seguem o mapa. Relança o que não souber tratar.
 */
export async function respostaErroKits(
  e: unknown,
  nomeProduto: (itemId: string) => Promise<string | null>,
): Promise<{ status: number; body: { error: string; itemId?: string } }> {
  const s = separarItem((e as { message?: string })?.message)
  if (s) {
    const m = erroComItem(s.codigo, await nomeProduto(s.itemId))
    if (m) return { status: m.status, body: { error: m.error, itemId: s.itemId } }
    throw e
  }
  return respostaDeErro(e, ERROS_KITS)
}
