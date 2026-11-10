import type { Painel } from '@/lib/indicadores/painel'
import { brl } from '@/components/financeiro/formatoComissao'

const brlNull = (c: number | null) => (c === null ? '—' : brl(c))

export default function BlocoFinanceiro({ financeiro }: { financeiro: Painel['financeiro'] }) {
  const linhas: [string, number, number | null][] = [
    ['Particular', financeiro.particularCentavos, financeiro.ticketParticularCentavos],
    ['Convênio', financeiro.convenioCentavos, financeiro.ticketConvenioCentavos],
  ]
  return (
    <section className="bg-white rounded-xl border border-[#E5E7EB] p-5 space-y-4">
      <h2 className="text-base font-semibold text-[#111827]">Financeiro</h2>
      <div className="grid grid-cols-2 gap-4">
        {linhas.map(([nome, total, ticket]) => (
          <div key={nome} className="rounded-lg border border-[#E5E7EB] p-3">
            <div className="text-xs text-[#6B7280]">{nome}</div>
            <div className="text-lg font-bold text-[#111827]">{brl(total)}</div>
            <div className="text-xs text-[#6B7280]">Ticket médio: {brlNull(ticket)}</div>
          </div>
        ))}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-[#111827] mb-2">
          Produção por dentista <span className="font-normal text-[#6B7280]">(total {brl(financeiro.producao.totalCentavos)})</span>
        </h3>
        {financeiro.producao.porDentista.length === 0 ? (
          <p className="text-sm text-[#9CA3AF]">Nenhum tratamento concluído no mês.</p>
        ) : (
          <ul className="divide-y divide-[#F3F4F6]">
            {financeiro.producao.porDentista.map((d) => (
              <li key={d.professional_id ?? 'sem'} className="flex justify-between py-2 text-sm text-[#374151]">
                <span>{d.nome}</span>
                <span className="font-medium">{brl(d.totalCentavos)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
