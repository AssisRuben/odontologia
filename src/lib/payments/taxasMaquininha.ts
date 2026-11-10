// Taxas da maquininha própria da clínica (guardadas em clinics.card_rates).
// Servem para calcular o valor líquido dos pagamentos lançados à mão; o líquido alimenta
// as comissões (base depois da taxa) e o Livro-caixa (taxa como despesa dedutível).

import type { PaymentMethod } from '@/types'

export type FaixaTaxa = 'debito' | 'credito_vista' | 'credito_2a6' | 'credito_7a12' | 'pix'

export type TaxasMaquininha = Partial<Record<FaixaTaxa, number>>

export const FAIXAS: { chave: FaixaTaxa; rotulo: string; dica?: string }[] = [
  { chave: 'debito', rotulo: 'Débito' },
  { chave: 'credito_vista', rotulo: 'Crédito à vista' },
  { chave: 'credito_2a6', rotulo: 'Crédito em 2 a 6 parcelas' },
  { chave: 'credito_7a12', rotulo: 'Crédito em 7 a 12 parcelas' },
  { chave: 'pix', rotulo: 'Pix na maquininha', dica: 'Deixe em branco se o Pix cai direto na conta, sem taxa.' },
]

const CHAVES = new Set<string>(FAIXAS.map((f) => f.chave))

/** Percentual digitado ("2,5", "3.19"); vazio vale 0. Nulo se inválido ou fora de 0–100. */
export function lerPercentual(texto: string): number | null {
  const t = (texto ?? '').trim().replace(',', '.')
  if (t === '') return 0
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  const n = Number(t)
  return n >= 0 && n <= 100 ? n : null
}

export function formatarPercentual(n: number): string {
  return String(Math.round(n * 100) / 100).replace('.', ',')
}

/** Lê o JSON salvo na clínica; descarta o que não for uma faixa conhecida com taxa válida. */
export function lerTaxas(bruto: unknown): TaxasMaquininha {
  const taxas: TaxasMaquininha = {}
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return taxas
  for (const [chave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (!CHAVES.has(chave)) continue
    let n: number | null = null
    if (typeof valor === 'number' && Number.isFinite(valor)) n = valor >= 0 && valor <= 100 ? valor : null
    else if (typeof valor === 'string' && valor.trim() !== '') n = lerPercentual(valor)
    if (n !== null) taxas[chave as FaixaTaxa] = n
  }
  return taxas
}

export function faixaPara(metodo: PaymentMethod, parcelas: number): FaixaTaxa | null {
  if (metodo === 'cartao_debito') return 'debito'
  if (metodo === 'pix') return 'pix'
  if (metodo !== 'cartao_credito') return null
  if (parcelas <= 1) return 'credito_vista'
  return parcelas <= 6 ? 'credito_2a6' : 'credito_7a12'
}

/** Taxa em % para a forma de pagamento; 0 se a faixa não foi configurada; nulo se não se aplica. */
export function taxaPara(taxas: TaxasMaquininha, metodo: PaymentMethod, parcelas: number): number | null {
  const faixa = faixaPara(metodo, parcelas)
  return faixa ? (taxas[faixa] ?? 0) : null
}

export function liquidoCentavos(brutoCentavos: number, percentual: number): number {
  const p = Math.min(100, Math.max(0, percentual))
  return Math.round(brutoCentavos * (1 - p / 100))
}
