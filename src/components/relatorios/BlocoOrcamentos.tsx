import Link from 'next/link'
import type { Painel } from '@/lib/indicadores/painel'
import { brl } from '@/components/financeiro/formatoComissao'
import { pctInteiro } from './CartaoIndicador'

const th = 'px-4 py-2 text-left text-xs font-medium text-[#6B7280] uppercase whitespace-nowrap'
const thR = th.replace('text-left', 'text-right')
const tdR = 'px-4 py-2 text-sm text-[#374151] text-right whitespace-nowrap'

export default function BlocoOrcamentos({ orcamentos }: { orcamentos: Painel['orcamentos'] }) {
  const dias = orcamentos.avgDaysToApprove
  return (
    <section className="bg-white rounded-xl border border-[#E5E7EB] p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[#111827]">Orçamentos</h2>
        <Link href="/orcamentos" className="text-xs font-medium text-[#3B82F6] hover:underline">Ver orçamentos</Link>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-[#374151]">
        <span>Apresentados: <b>{orcamentos.presented.count}</b> ({brl(orcamentos.presented.cents)})</span>
        <span>Aprovados: <b>{orcamentos.approved.count}</b> ({brl(orcamentos.approved.cents)})</span>
        <span>Aprovação em valor: <b>{pctInteiro(orcamentos.rateCents)}</b></span>
        <span>Aprovação em quantidade: <b>{pctInteiro(orcamentos.rateCount)}</b></span>
        <span>Tempo médio até aprovar: <b>{dias === null ? '—' : `${String(Math.round(dias * 10) / 10).replace('.', ',')} dias`}</b></span>
      </div>
      <div className="overflow-x-auto border border-[#E5E7EB] rounded-lg">
        <table className="w-full">
          <thead className="border-b border-[#E5E7EB]">
            <tr>
              <th className={th}>Dentista</th>
              <th className={thR}>Apresentados</th>
              <th className={thR}>Aprovados</th>
              <th className={thR}>Aprovação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F3F4F6]">
            {orcamentos.byProfessional.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-[#9CA3AF]">Nenhum orçamento apresentado no mês.</td></tr>
            )}
            {orcamentos.byProfessional.map((p) => (
              <tr key={p.id ?? 'sem'}>
                <td className="px-4 py-2 text-sm font-medium text-[#111827]">{p.name}</td>
                <td className={tdR}>{p.presented.count} · {brl(p.presented.cents)}</td>
                <td className={tdR}>{p.approved.count} · {brl(p.approved.cents)}</td>
                <td className={tdR}>{pctInteiro(p.rateCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
