// Textos das respostas de erro das rotas do fluxo de caixa.

import type { Mapa } from '@/lib/convenios/rotas'

export const ERROS_FLUXO: Mapa = {
  VALOR_INVALIDO: { status: 422, error: 'Valor inválido' },
  DIA_INVALIDO: { status: 422, error: 'Dia inválido' },
  PERIODO_INVALIDO: { status: 422, error: 'Período inválido' },
  DADOS_INVALIDOS: { status: 422, error: 'Dados inválidos' },
  RECORRENCIA_NAO_ENCONTRADA: { status: 404, error: 'Recorrência não encontrada' },
}
