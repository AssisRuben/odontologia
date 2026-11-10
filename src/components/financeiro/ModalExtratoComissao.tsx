'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, X } from 'lucide-react'
import type { Extrato } from '@/lib/comissoes/calculo'
import { rotuloMes } from '@/lib/comissoes/periodo'
import { brl, dmy, pct } from './formatoComissao'

const ORIGEM = { particular: 'Particular', convenio: 'Convênio', recurso: 'Recurso' } as const

interface Props {
  professionalId: string
  nome: string
  mes: string
  /** closed_at do fechamento (ISO), quando o mês está fechado */
  fechadoEm: string | null
  onClose: () => void
}

const th = 'px-3 py-2 text-left text-xs font-medium text-tinta-3 uppercase'
const thR = th.replace('text-left', 'text-right')
const td = 'px-3 py-2 text-sm text-tinta-2'
const tdR = `${td} text-right whitespace-nowrap`

export default function ModalExtratoComissao({ professionalId, nome, mes, fechadoEm, onClose }: Props) {
  const [x, setX] = useState<Extrato | null>(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let ativo = true
    fetch(`/api/comissoes/${professionalId}?mes=${mes}`, { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}))
        if (!ativo) return
        if (!res.ok) setErro(json.error || 'Não foi possível carregar o extrato')
        else setX(json as Extrato)
      })
      .catch(() => { if (ativo) setErro('Não foi possível carregar o extrato') })
    return () => { ativo = false }
  }, [professionalId, mes])

  const fechadoDia = fechadoEm
    ? new Date(fechadoEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    : null

  // Portal no body: na impressão só o extrato fica visível (o resto da página é ocultado).
  return createPortal(
    <div className="extrato-root fixed inset-0 z-50 flex items-center justify-center">
      <style>{`@media print {
        body > *:not(.extrato-root) { display: none !important; }
        .extrato-root { position: static !important; display: block !important; }
        .extrato-fundo, .no-print { display: none !important; }
        .extrato-caixa { max-width: none !important; max-height: none !important; overflow: visible !important; box-shadow: none !important; margin: 0 !important; }
      }`}</style>
      <div className="extrato-fundo absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="extrato-caixa relative bg-white rounded-xl shadow-xl w-full max-w-4xl mx-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-linha">
          <div>
            <h2 className="text-base font-semibold text-tinta">Extrato de comissão — {nome}</h2>
            <p className="text-xs text-tinta-3">
              {rotuloMes(mes)}
              {fechadoDia && <> · Fechado em {fechadoDia}</>}
            </p>
          </div>
          <button onClick={onClose} className="no-print p-1 rounded text-tinta-4 hover:text-tinta-2" aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {erro && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
          {!x && !erro && (
            <div className="flex justify-center py-10">
              <div className="w-6 h-6 border-2 border-petroleo border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {x && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-linha">
                    <tr>
                      <th className={th}>Data</th><th className={th}>Paciente</th><th className={th}>Tratamento</th>
                      <th className={th}>Origem</th><th className={thR}>Base</th><th className={thR}>%</th><th className={thR}>Comissão</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-porcelana">
                    {x.partes.length === 0 && (
                      <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-tinta-4">Nenhum recebimento comissionável neste mês.</td></tr>
                    )}
                    {x.partes.map((p, i) => (
                      <tr key={i}>
                        <td className={td}>{dmy(p.data)}</td>
                        <td className={td}>{p.paciente}</td>
                        <td className={td}>{p.descricao}</td>
                        <td className={td}>{ORIGEM[p.origem]}</td>
                        <td className={tdR}>{brl(p.baseCentavos)}</td>
                        <td className={tdR}>{pct(p.percentual)}</td>
                        <td className={tdR}>{brl(p.comissaoCentavos)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {x.laboratorio.length > 0 && (
                <div className="overflow-x-auto">
                  <h3 className="text-sm font-semibold text-tinta mb-2">Descontos de laboratório</h3>
                  <table className="w-full">
                    <thead className="border-b border-linha">
                      <tr>
                        <th className={th}>Data</th><th className={th}>Descrição</th>
                        <th className={thR}>Custo</th><th className={thR}>%</th><th className={thR}>Desconto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-porcelana">
                      {x.laboratorio.map((l, i) => (
                        <tr key={i}>
                          <td className={td}>{dmy(l.data)}</td>
                          <td className={td}>{l.descricao}</td>
                          <td className={tdR}>{brl(l.custoCentavos)}</td>
                          <td className={tdR}>{pct(l.percentual)}</td>
                          <td className={tdR}>−{brl(l.descontoCentavos)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="border-t border-linha pt-3 space-y-1.5 text-sm">
                <div className="flex justify-between text-tinta-2">
                  <span>Comissão do mês</span><span>{brl(x.comissaoMesCentavos)}</span>
                </div>
                <div className="flex justify-between text-tinta-2">
                  <span>Ajustes de meses anteriores</span><span>{brl(x.ajusteCentavos)}</span>
                </div>
                <div className="flex justify-between font-bold text-tinta text-base">
                  <span>Total</span><span>{brl(x.totalCentavos)}</span>
                </div>
              </div>
            </>
          )}

          <div className="no-print flex justify-end gap-3">
            <button type="button" onClick={onClose}
              className="h-10 px-4 rounded-lg border border-linha text-sm font-medium text-tinta-3 hover:bg-porcelana">
              Fechar
            </button>
            <button type="button" onClick={() => window.print()} disabled={!x}
              className="flex items-center gap-1.5 h-10 px-4 rounded-lg bg-petroleo text-white text-sm font-medium hover:bg-petroleo-escuro disabled:opacity-50">
              <Printer className="w-4 h-4" /> Imprimir
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
