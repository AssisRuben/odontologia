import type { Mapa } from '@/lib/convenios/rotas'

/** Erros das funções SQL de comissão → resposta HTTP. */
export const ERROS_COMISSAO: Mapa = {
  MES_ABERTO: { status: 409, error: 'O mês ainda não terminou' },
  VALOR_INVALIDO: { status: 409, error: 'Não há comissão a fechar neste mês' },
  FECHAMENTO_EXISTE: { status: 409, error: 'Este mês já foi fechado' },
  FECHAMENTO_POSTERIOR: { status: 409, error: 'Há um mês posterior fechado; reabra-o antes' },
  FECHAMENTO_PAGO: { status: 409, error: 'Desfaça o pagamento antes de reabrir' },
  FECHAMENTO_JA_PAGO: { status: 409, error: 'Comissão já está paga' },
  FECHAMENTO_NAO_PAGO: { status: 409, error: 'Comissão não está paga' },
  FECHAMENTO_INVALIDO: { status: 404, error: 'Fechamento não encontrado' },
  PROFISSIONAL_INVALIDO: { status: 404, error: 'Profissional não encontrado' },
  PERIODO_INVALIDO: { status: 422, error: 'Mês inválido' },
  ANTES_DO_INICIO: { status: 409, error: 'Mês anterior ao início da comissão' },
  // A trava impede o fechamento duplo; a UNIQUE de commission_closings é só a última defesa.
  '23505': { status: 409, error: 'Este mês já foi fechado' },
}
