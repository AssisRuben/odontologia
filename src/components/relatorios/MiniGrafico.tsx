export type PontoGrafico = { mes: string; valor: number | null }

/** 'YYYY-MM' -> 'mm/aa' */
const rotulo = (mes: string) => `${mes.slice(5, 7)}/${mes.slice(2, 4)}`

export default function MiniGrafico({
  titulo,
  pontos,
  formato,
}: {
  titulo: string
  pontos: PontoGrafico[]
  formato: (valor: number) => string
}) {
  const max = Math.max(0, ...pontos.map((p) => p.valor ?? 0))
  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-4">
      <h3 className="text-sm font-semibold text-[#111827] mb-3">{titulo}</h3>
      <div className="h-28 flex items-end gap-2">
        {pontos.map((p) => {
          const altura = p.valor !== null && max > 0 ? Math.max(2, Math.round((p.valor / max) * 64)) : 2
          return (
            <div key={p.mes} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0">
              <span className="text-[10px] text-[#6B7280] truncate max-w-full">{p.valor === null ? '—' : formato(p.valor)}</span>
              <div className="w-full rounded-t bg-[#3B82F6]" style={{ height: `${altura}px`, opacity: p.valor === null ? 0.2 : 1 }} />
              <span className="text-[10px] text-[#9CA3AF]">{rotulo(p.mes)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
