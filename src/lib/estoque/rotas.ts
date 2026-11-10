// Textos das respostas de erro das rotas de estoque.

import type { Mapa } from '@/lib/convenios/rotas'

export const ERROS_ESTOQUE: Mapa = {
  PRODUTO_NAO_ENCONTRADO: { status: 404, error: 'Produto não encontrado' },
  PRODUTO_INATIVO: { status: 409, error: 'Produto inativo' },
  QUANTIDADE_INVALIDA: { status: 422, error: 'Quantidade inválida' },
  ESTOQUE_INSUFICIENTE: { status: 409, error: 'Estoque insuficiente' },
  LOTE_INVALIDO: { status: 422, error: 'Lote não encontrado' },
  LOTE_OBRIGATORIO: { status: 422, error: 'Informe a validade do lote' },
  TIPO_INVALIDO: { status: 422, error: 'Dados inválidos' },
  PAGAMENTO_INVALIDO: { status: 422, error: 'Pagamento inválido' },
  '23505': { status: 409, error: 'Já existe um produto com esse nome' },
}
