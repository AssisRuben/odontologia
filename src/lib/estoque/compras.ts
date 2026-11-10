import type { InventoryItem } from '@/types'

const SEM_FORNECEDOR = 'Sem fornecedor'

export function sugestaoCompra(item: InventoryItem): number {
  const alvo = item.ideal_quantity ?? 2 * item.min_quantity
  return Math.max(0, alvo - item.quantity)
}

export type GrupoCompra = {
  fornecedor: string
  itens: { id: string; nome: string; quantidade: number; unidade: string }[]
}

/** Itens ativos com quantity <= min_quantity e sugestão > 0, agrupados por fornecedor. */
export function listaDeCompras(itens: InventoryItem[]): GrupoCompra[] {
  const grupos = new Map<string, { fornecedor: string; itens: GrupoCompra['itens'] }>()
  for (const i of itens) {
    if (!i.active || i.quantity > i.min_quantity) continue
    const quantidade = sugestaoCompra(i)
    if (quantidade <= 0) continue
    const fornecedor = i.supplier?.trim() || SEM_FORNECEDOR
    const chave = fornecedor.toLowerCase()
    const grupo = grupos.get(chave) ?? { fornecedor, itens: [] }
    grupo.itens.push({ id: i.id, nome: i.name, quantidade, unidade: i.unit?.trim() ?? '' })
    grupos.set(chave, grupo)
  }
  const cmp = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })
  return [...grupos.values()]
    .map((g) => ({ fornecedor: g.fornecedor, itens: g.itens.sort((a, b) => cmp(a.nome, b.nome)) }))
    .sort((a, b) => {
      if (a.fornecedor === SEM_FORNECEDOR) return 1
      if (b.fornecedor === SEM_FORNECEDOR) return -1
      return cmp(a.fornecedor, b.fornecedor)
    })
}

export function textoListaCompras(grupos: GrupoCompra[], clinica: string, hojeYmd: string): string {
  const [y, m, d] = hojeYmd.split('-')
  const linhas = [`Lista de compras — ${clinica} — ${d}/${m}/${y}`]
  for (const g of grupos) {
    linhas.push('', `*${g.fornecedor}*`)
    for (const i of g.itens) linhas.push(`• ${i.nome} — ${i.quantidade}${i.unidade ? ` ${i.unidade}` : ''}`)
  }
  return linhas.join('\n')
}
