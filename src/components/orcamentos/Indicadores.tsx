import { formatCurrency } from '@/lib/utils'
import type { Funnel } from '@/lib/orcamentos/funil'

export const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)
const reais = (cents: number) => formatCurrency(cents / 100)
const days = (v: number | null) =>
  v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${v === 1 ? 'dia' : 'dias'}`

function Card({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-linha p-4">
      <p className="text-xs text-tinta-3">{title}</p>
      <p className="text-xl font-bold text-tinta mt-1">{value}</p>
      {sub && <p className="text-xs text-tinta-3 mt-0.5">{sub}</p>}
    </div>
  )
}

export function Indicadores({ funnel }: { funnel: Funnel }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card title="Apresentado" value={reais(funnel.presented.cents)} sub={`${funnel.presented.count} orçamento(s)`} />
        <Card title="Aprovado" value={reais(funnel.approved.cents)} sub={`${funnel.approved.count} orçamento(s)`} />
        <Card title="Taxa de aprovação" value={pct(funnel.rateCents)} sub={`${pct(funnel.rateCount)} em quantidade`} />
        <Card title="Tempo médio até aprovar" value={days(funnel.avgDaysToApprove)} />
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-linha p-4 overflow-x-auto">
          <h3 className="text-sm font-semibold text-tinta mb-2">Por dentista</h3>
          {funnel.byProfessional.length === 0 ? <p className="text-sm text-tinta-3">Sem dados no período.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-tinta-3">
                <th className="py-1 font-medium">Dentista</th><th className="font-medium">Apresentado</th>
                <th className="font-medium">Aprovado</th><th className="font-medium text-right">Taxa</th>
              </tr></thead>
              <tbody>
                {funnel.byProfessional.map(p => (
                  <tr key={p.id ?? 'none'} className="border-t border-porcelana">
                    <td className="py-1.5">{p.name}</td>
                    <td>{reais(p.presented.cents)} ({p.presented.count})</td>
                    <td>{reais(p.approved.cents)} ({p.approved.count})</td>
                    <td className="text-right">{pct(p.rateCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-white rounded-xl border border-linha p-4">
          <h3 className="text-sm font-semibold text-tinta mb-2">Motivos de perda</h3>
          {funnel.lostReasons.length === 0 ? <p className="text-sm text-tinta-3">Nenhuma perda no período.</p> : (
            <ul className="text-sm space-y-1">
              {funnel.lostReasons.map(l => (
                <li key={l.code} className="flex justify-between"><span>{l.label}</span><span className="font-medium">{l.count}</span></li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
