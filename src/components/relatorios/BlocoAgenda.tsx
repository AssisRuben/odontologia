import Link from 'next/link'
import type { Painel } from '@/lib/indicadores/painel'
import { pctInteiro } from './CartaoIndicador'

const th = 'px-4 py-2 text-left text-xs font-medium text-[#6B7280] uppercase whitespace-nowrap'
const thR = th.replace('text-left', 'text-right')
const tdR = 'px-4 py-2 text-sm text-[#374151] text-right whitespace-nowrap'
const dmy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`

export default function BlocoAgenda({ agenda }: { agenda: Painel['agenda'] }) {
  return (
    <section className="bg-white rounded-xl border border-[#E5E7EB] p-5 space-y-4">
      <h2 className="text-base font-semibold text-[#111827]">Agenda</h2>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-[#374151]">
        <span>Atendidas: <b>{agenda.atendidas}</b></span>
        <span>Faltas: <b>{agenda.faltas}</b> ({pctInteiro(agenda.taxaFaltas)})</span>
        <span>Canceladas: <b>{agenda.canceladas}</b> ({pctInteiro(agenda.taxaCancelamento)})</span>
        <span>Comparecimento: <b>{pctInteiro(agenda.comparecimento)}</b></span>
      </div>
      {agenda.semDesfecho > 0 && (
        <p className="text-sm text-[#92400E] bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {agenda.semDesfecho} {agenda.semDesfecho === 1 ? 'consulta sem desfecho' : 'consultas sem desfecho'}{' '}
          <Link href="/agenda" className="font-medium text-[#3B82F6] underline">Abrir a Agenda</Link>
        </p>
      )}

      <div className="overflow-x-auto border border-[#E5E7EB] rounded-lg">
        <table className="w-full">
          <thead className="border-b border-[#E5E7EB]">
            <tr>
              <th className={th}>Dentista</th>
              <th className={thR}>Atendidas</th>
              <th className={thR}>Faltas</th>
              <th className={thR}>Canceladas</th>
              <th className={thR}>Comparecimento</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F3F4F6]">
            {agenda.porDentista.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-[#9CA3AF]">Sem consultas no mês.</td></tr>
            )}
            {agenda.porDentista.map((d) => (
              <tr key={d.professional_id}>
                <td className="px-4 py-2 text-sm font-medium text-[#111827]">{d.nome}</td>
                <td className={tdR}>{d.atendidas}</td>
                <td className={tdR}>{d.faltas}</td>
                <td className={tdR}>{d.canceladas}</td>
                <td className={tdR}>{pctInteiro(d.comparecimento)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-[#111827] mb-2">Pacientes que mais faltam (6 meses)</h3>
        {agenda.maisFaltam.length === 0 ? (
          <p className="text-sm text-[#9CA3AF]">Ninguém faltou 2 vezes ou mais no período.</p>
        ) : (
          <ul className="divide-y divide-[#F3F4F6]">
            {agenda.maisFaltam.map((p) => (
              <li key={p.patient_id} className="flex items-center justify-between py-2 text-sm">
                <Link href={`/pacientes/${p.patient_id}`} className="font-medium text-[#3B82F6] hover:underline">
                  {p.nome || 'Paciente'}
                </Link>
                <span className="text-[#6B7280]">{p.faltas} faltas · última em {dmy(p.ultima)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
