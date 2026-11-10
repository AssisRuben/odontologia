'use client'

import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { MesFluxo } from '@/lib/fluxo/calcular'
import { formatCurrency } from '@/lib/utils'

const W = 720
const H = 260
const PAD = { top: 16, right: 12, bottom: 28, left: 12 }

export function rotuloMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number)
  return format(new Date(y, m - 1, 1), 'MMM/yy', { locale: ptBR })
}

export default function GraficoFluxo({ meses }: { meses: MesFluxo[] }) {
  if (meses.length === 0) return null

  // A escala cobre barras e pontos de saldo (inclusive o saldo inicial do 1º mês) e sempre o zero.
  const valores = [0, meses[0].saldoInicialCentavos, ...meses.flatMap((m) => [m.entradasCentavos, m.saidasCentavos, m.saldoFinalCentavos])]
  const rawMax = Math.max(...valores)
  const rawMin = Math.min(...valores)
  const folga = (rawMax - rawMin || 1) * 0.06
  const max = rawMax + folga
  const min = rawMin < 0 ? rawMin - folga : rawMin
  const span = max - min || 1
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const y = (v: number) => PAD.top + ((max - v) / span) * innerH
  const y0 = y(0)
  const slot = innerW / meses.length
  const barW = Math.min(22, slot / 3)
  const cx = (i: number) => PAD.left + slot * i + slot / 2
  const temNegativo = min < 0

  const pts = meses.map((m, i) => ({ x: cx(i), y: y(m.saldoFinalCentavos), previsto: m.situacao === 'previsto' }))
  // sólido até o último mês não previsto; tracejado a partir dele
  const ultimoSolido = pts.reduce((acc, p, i) => (p.previsto ? acc : i), -1)
  const solido = pts.slice(0, ultimoSolido + 1)
  const tracejado = pts.slice(Math.max(ultimoSolido, 0))
  const path = (ps: { x: number; y: number }[]) => ps.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')

  return (
    <div className="bg-white rounded-xl border border-linha p-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Gráfico do fluxo de caixa">
        <line x1={PAD.left} x2={W - PAD.right} y1={y0} y2={y0}
          stroke={temNegativo ? '#6B7280' : '#E5E7EB'} strokeWidth={temNegativo ? 1.5 : 1} />
        {meses.map((m, i) => {
          const x = cx(i)
          return (
            <g key={m.mes}>
              <g opacity={m.situacao === 'previsto' ? 0.5 : 1}>
              <rect x={x - barW - 1} y={y(m.entradasCentavos)} width={barW} height={Math.max(y0 - y(m.entradasCentavos), 0)}
                fill="#10B981" rx={2}>
                <title>{`Entradas ${rotuloMes(m.mes)}: ${formatCurrency(m.entradasCentavos / 100)}`}</title>
              </rect>
              <rect x={x + 1} y={y(m.saidasCentavos)} width={barW} height={Math.max(y0 - y(m.saidasCentavos), 0)}
                fill="#EF4444" rx={2}>
                <title>{`Saídas ${rotuloMes(m.mes)}: ${formatCurrency(m.saidasCentavos / 100)}`}</title>
              </rect>
              </g>
              <text x={x} y={H - 8} textAnchor="middle" fontSize={11} fill="#6B7280">{rotuloMes(m.mes)}</text>
            </g>
          )
        })}
        {solido.length > 1 && <path d={path(solido)} fill="none" className="stroke-petroleo" strokeWidth={2} />}
        {tracejado.length > 1 && (
          <path d={path(tracejado)} fill="none" className="stroke-petroleo" strokeWidth={2} strokeDasharray="5 4" opacity={0.7} />
        )}
        {pts.map((p, i) => (
          <circle key={meses[i].mes} cx={p.x} cy={p.y} r={3.5} className="fill-petroleo" opacity={p.previsto ? 0.5 : 1}>
            <title>{`Saldo final ${rotuloMes(meses[i].mes)}: ${formatCurrency(meses[i].saldoFinalCentavos / 100)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="flex flex-wrap gap-4 text-xs text-tinta-3 mt-2">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-[#10B981] inline-block" />Entradas</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-[#EF4444] inline-block" />Saídas</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-petroleo inline-block" />Saldo final</span>
      </div>
    </div>
  )
}
