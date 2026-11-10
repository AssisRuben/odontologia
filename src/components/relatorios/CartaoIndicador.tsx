import { rotuloVariacao, type Variacao } from '@/lib/indicadores/variacao'

export const pctInteiro = (fracao: number | null) => (fracao === null ? '—' : `${Math.round(fracao * 100)}%`)

function corVariacao(v: Variacao, altaEhRuim: boolean): string {
  if (v.tipo !== 'pp' && v.tipo !== 'pct') return 'text-[#6B7280]'
  if (v.valor === null || v.valor === 0) return 'text-[#6B7280]'
  const bom = (v.valor > 0) !== altaEhRuim
  return bom ? 'text-[#10B981]' : 'text-[#EF4444]'
}

export default function CartaoIndicador({
  titulo,
  valor,
  variacao,
  altaEhRuim = false,
  nota,
}: {
  titulo: string
  valor: string
  variacao: Variacao
  altaEhRuim?: boolean
  nota?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
      <span className="text-sm text-[#6B7280]">{titulo}</span>
      <div className="text-2xl font-bold text-[#111827] mt-2">{valor}</div>
      <div className={`text-xs mt-1 ${corVariacao(variacao, altaEhRuim)}`}>
        {rotuloVariacao(variacao)} <span className="text-[#9CA3AF]">vs. mês anterior</span>
      </div>
      {nota && <div className="text-xs mt-1 text-[#92400E]">{nota}</div>}
    </div>
  )
}
