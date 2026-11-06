import { z } from 'zod'

/** Modo estrito da OpenAI: todos os campos obrigatórios; opcionais viram anuláveis. */
export const EvolucaoOutputSchema = z.object({
  secoes: z.object({
    motivo: z.string().nullable(),
    procedimentos: z.string().nullable(),
    observacoes: z.string().nullable(),
    proximos_passos: z.string().nullable(),
  }),
  sugestoes: z.array(
    z.object({
      tipo: z.enum(['item_orcamento', 'tratamento', 'tratamento_novo', 'retorno']),
      ref: z.string().nullable(),
      novo_status: z.enum(['in_progress', 'completed']).nullable(),
      procedimento: z.string().nullable(),
      dentes: z.array(z.number()).nullable(),
      faces: z.array(z.string()).nullable(),
      status: z.enum(['completed', 'planned']).nullable(),
      dias: z.number().nullable(),
      motivo: z.string().nullable(),
    }),
  ),
})

export type EvolucaoOutput = z.infer<typeof EvolucaoOutputSchema>

export const EVOLUCAO_SYSTEM = `Você organiza o ditado de um dentista em uma evolução clínica de prontuário.

Regras:
- Escreva em português do Brasil, em linguagem clínica objetiva.
- Não invente nada que não foi dito. Se uma seção não foi mencionada, use null.
- Seções: motivo (queixa ou motivo da consulta), procedimentos (o que foi realizado, sempre com dente e faces), observacoes, proximos_passos.
- Numeração de dentes FDI (11 a 48 permanentes; 51 a 85 decíduos). Faces somente entre V M O D L (vestibular, mesial, oclusal, distal, lingual).
- Você recebe uma ficha com os tratamentos (T1, T2...) e itens de orçamento (O1, O2...) em aberto do paciente. Use apenas esses apelidos nas sugestões; nunca invente um apelido.
- sugestoes tipo item_orcamento (apelido O#) ou tratamento (apelido T#): somente quando o ditado diz que o item foi iniciado ou concluído; novo_status é in_progress ou completed.
- sugestoes tipo tratamento_novo: somente para procedimento realizado ou indicado que não está na ficha; informe procedimento, dentes (lista, pode ser vazia), faces (lista, pode ser vazia) e status (completed se realizado, planned se apenas indicado).
- sugestoes tipo retorno: somente se o dentista pedir retorno; dias entre 1 e 365 e motivo curto.
- Em cada sugestão, preencha os campos que não se aplicam ao tipo com null.
- Sem sugestões claras, devolva a lista vazia.`

const TITULOS: [keyof EvolucaoOutput['secoes'], string][] = [
  ['motivo', 'Motivo'],
  ['procedimentos', 'Procedimentos realizados'],
  ['observacoes', 'Observações'],
  ['proximos_passos', 'Próximos passos'],
]

/** Monta o texto final da evolução; seções nulas ou vazias não aparecem. */
export function montarTexto(secoes: EvolucaoOutput['secoes']): string {
  return TITULOS.flatMap(([campo, titulo]) => {
    const texto = secoes[campo]?.trim()
    return texto ? [`${titulo}\n${texto}`] : []
  }).join('\n\n')
}
