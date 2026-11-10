import type { Painel } from '@/lib/indicadores/painel'
import { brl } from '@/components/financeiro/formatoComissao'

const brlNull = (c: number | null) => (c === null ? '—' : brl(c))

export default function BlocoFinanceiro({ financeiro }: { financeiro: Painel['financeiro'] }) {
  const linhas: [string, number, number | null][] = [
    ['Particular', financeiro.particularCentavos, financeiro.ticketParticularCentavos],
    ['Convênio', financeiro.convenioCentavos, financeiro.ticketConvenioCentavos],
  ]
  return (
    <section className="bg-white rounded-xl border border-linha p-5 space-y-4">
      <h2 className="text-base font-semibold text-tinta">Financeiro</h2>
      <div className="grid grid-cols-2 gap-4">
        {linhas.map(([nome, total, ticket]) => (
          <div key={nome} className="rounded-lg border border-linha p-3">
            <div className="text-xs text-tinta-3">{nome}</div>
            <div className="text-lg font-bold text-tinta">{brl(total)}</div>
            <div className="text-xs text-tinta-3">Ticket médio: {brlNull(ticket)}</div>
          </div>
        ))}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-tinta mb-2">
          Produção por dentista <span className="font-normal text-tinta-3">(total {brl(financeiro.producao.totalCentavos)})</span>
        </h3>
        {financeiro.producao.porDentista.length === 0 ? (
          <p className="text-sm text-tinta-4">Nenhum tratamento concluído no mês.</p>
        ) : (
          <ul className="divide-y divide-porcelana">
            {financeiro.producao.porDentista.map((d) => (
              <li key={d.professional_id ?? 'sem'} className="flex justify-between py-2 text-sm text-tinta-2">
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
