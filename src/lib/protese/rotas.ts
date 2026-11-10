// Textos das respostas de erro das rotas de prótese e laboratório.

import type { Mapa } from '@/lib/convenios/rotas'

export const ERROS_PROTESE: Mapa = {
  PROTESE_NAO_ENCONTRADA: { status: 404, error: 'Trabalho não encontrado' },
  PROTESE_CONFLITO: { status: 409, error: 'Este trabalho foi atualizado por outra pessoa' },
  MESMA_ETAPA: { status: 422, error: 'Escolha outra etapa' },
  ETAPA_INVALIDA: { status: 422, error: 'Etapa inválida' },
  PACIENTE_INVALIDO: { status: 422, error: 'Paciente não encontrado' },
  PROFISSIONAL_INVALIDO: { status: 422, error: 'Profissional não encontrado' },
  LABORATORIO_INVALIDO: { status: 422, error: 'Laboratório não encontrado' },
}

export const ERROS_LABORATORIO: Mapa = {
  '23505': { status: 409, error: 'Já existe um laboratório com esse nome' },
}
