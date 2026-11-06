import { formatDataLonga } from '@/lib/messaging/time'

export type FichaInput = {
  treatments: {
    id: string
    procedure: string
    status: 'planned' | 'in_progress'
    date: string
    teeth: { tooth_number: number; faces: string[] }[]
  }[]
  budgetItems: {
    id: string
    procedure: string
    tooth: string | null
    status: 'pending' | 'in_progress'
    budget_date: string
  }[]
}

export type Ref = { kind: 'item' | 'tratamento'; id: string; status: string; label: string; budgetDate?: string }

const MAX_POR_TIPO = 50

const STATUS_LABEL: Record<string, string> = {
  planned: 'planejado',
  in_progress: 'em andamento',
  pending: 'pendente',
}

/** Mais recentes primeiro; empates mantêm a ordem de entrada. */
function maisRecentes<T>(rows: T[], data: (r: T) => string): T[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => data(b.r).localeCompare(data(a.r)) || a.i - b.i)
    .slice(0, MAX_POR_TIPO)
    .map((x) => x.r)
}

/**
 * Ficha resumida enviada à IA. Só lê os campos de FichaInput: nenhum dado
 * pessoal do paciente entra no texto.
 */
export function buildFicha(input: FichaInput, today: string): { texto: string; refs: Map<string, Ref> } {
  const refs = new Map<string, Ref>()
  const linhas: string[] = [`Hoje: ${formatDataLonga(today)}`]

  const tratamentos = maisRecentes(input.treatments, (t) => t.date)
  if (tratamentos.length) linhas.push('', 'Tratamentos em aberto:')
  tratamentos.forEach((t, i) => {
    const apelido = `T${i + 1}`
    const dentes = t.teeth.map((d) => (d.faces.length ? `${d.tooth_number} (${d.faces.join(',')})` : String(d.tooth_number)))
    const partes = [apelido, t.procedure]
    if (dentes.length) partes.push(`dentes ${dentes.join(', ')}`)
    partes.push(STATUS_LABEL[t.status] ?? t.status)
    linhas.push(partes.join(' | '))
    const rotuloDentes = t.teeth.map((d) => d.faces.length ? `${d.tooth_number} ${d.faces.join("")}` : String(d.tooth_number)).join(', ')
    refs.set(apelido, {
      kind: 'tratamento', id: t.id, status: t.status,
      label: rotuloDentes ? `${t.procedure} ${rotuloDentes}` : t.procedure,
    })
  })

  const itens = maisRecentes(input.budgetItems, (b) => b.budget_date)
  if (itens.length) linhas.push('', 'Itens de orçamentos aprovados em aberto:')
  itens.forEach((b, i) => {
    const apelido = `O${i + 1}`
    const partes = [apelido, b.procedure]
    if (b.tooth) partes.push(`dente ${b.tooth}`)
    partes.push(STATUS_LABEL[b.status] ?? b.status, `orçamento de ${formatDataLonga(b.budget_date)}`)
    linhas.push(partes.join(' | '))
    refs.set(apelido, {
      kind: 'item', id: b.id, status: b.status,
      label: b.tooth ? `${b.procedure} ${b.tooth}` : b.procedure,
      budgetDate: b.budget_date,
    })
  })

  return { texto: linhas.join('\n'), refs }
}
