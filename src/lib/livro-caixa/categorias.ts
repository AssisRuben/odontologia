import type { DeductionGroup, ExpenseCategory } from '@/types'

export const CATEGORIES: readonly {
  code: ExpenseCategory
  label: string
  group: DeductionGroup | null
}[] = [
  { code: 'aluguel', label: 'Aluguel e condomínio', group: 'custeio' },
  { code: 'contas', label: 'Luz, água, telefone e internet', group: 'custeio' },
  { code: 'material', label: 'Material odontológico', group: 'custeio' },
  { code: 'laboratorio', label: 'Laboratório de prótese', group: 'custeio' },
  { code: 'servicos', label: 'Contador e serviços de terceiros', group: 'custeio' },
  { code: 'manutencao', label: 'Manutenção e limpeza', group: 'custeio' },
  { code: 'marketing', label: 'Marketing e divulgação', group: 'custeio' },
  { code: 'conselho', label: 'Anuidade do CRO e associações', group: 'custeio' },
  { code: 'iptu_taxas', label: 'IPTU e taxas do consultório', group: 'custeio' },
  { code: 'tarifas', label: 'Tarifas bancárias e de cobrança', group: 'custeio' },
  { code: 'salarios', label: 'Salários e encargos de funcionários', group: 'pessoal' },
  { code: 'emolumentos', label: 'Cartório e emolumentos', group: 'emolumentos' },
  { code: 'equipamentos', label: 'Equipamentos e móveis', group: null },
  { code: 'reformas', label: 'Reformas e obras', group: null },
  { code: 'cursos', label: 'Cursos e congressos', group: null },
  { code: 'comissoes', label: 'Comissões de dentistas', group: 'custeio' },
  { code: 'outras', label: 'Outras', group: null },
]

export function toCategory(code: string | null | undefined): ExpenseCategory {
  return CATEGORIES.find((c) => c.code === code)?.code ?? 'outras'
}

export function categoryLabel(code: string | null | undefined): string {
  return CATEGORIES.find((c) => c.code === toCategory(code))!.label
}

export function defaultGroup(code: ExpenseCategory): DeductionGroup | null {
  return CATEGORIES.find((c) => c.code === code)?.group ?? null
}

export function groupLabel(g: DeductionGroup | null): string {
  switch (g) {
    case 'custeio': return 'Despesas de custeio'
    case 'pessoal': return 'Salários e encargos'
    case 'emolumentos': return 'Emolumentos'
    default: return 'Não dedutível'
  }
}
