import { z } from 'zod'

export type Pergunta = {
  id: string
  text: string
  type: 'text' | 'yesno' | 'options'
  options?: string[]
}

/** Modo estrito da OpenAI: todos os campos obrigatórios; opcionais viram anuláveis. */
export const AnamneseOutputSchema = z.object({
  respostas: z.array(z.object({ id: z.string(), valor: z.string().nullable() })),
  observacoes: z.string().nullable(),
})

export type AnamneseOutput = z.infer<typeof AnamneseOutputSchema>

export const ANAMNESE_SYSTEM = `Você preenche a anamnese de um paciente de consultório odontológico a partir do que o dentista ou o paciente disse.

Regras:
- Escreva em português do Brasil.
- Não chute: se a pergunta não foi respondida no texto, devolva valor null para ela.
- Perguntas yesno: responda somente "Sim" ou "Não".
- Perguntas options: responda somente com uma das opções listadas, exatamente como escrita; se nada corresponder, use null.
- Perguntas text: resposta curta e objetiva.
- Detalhes que não cabem em nenhuma pergunta vão em observacoes (ou null se não houver).
- Use apenas os ids das perguntas recebidas; devolva uma entrada para cada pergunta.`

/** Uma linha por pergunta: `id | tipo | texto | opções: a; b`. */
export function perguntasTexto(ps: Pergunta[]): string {
  return ps
    .map(p => {
      const base = `${p.id} | ${p.type} | ${p.text}`
      return p.type === 'options' && p.options?.length ? `${base} | opções: ${p.options.join('; ')}` : base
    })
    .join('\n')
}
