'use client'

import { useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import type { Prosthetic, ProstheticStatus } from '@/types'
import { ETAPAS, acaoProxima, etapa, proximaEtapa } from '@/lib/protese/etapas'
import { diasDeAtraso } from '@/lib/protese/atraso'
import { idasAoLab } from '@/lib/protese/historico'
import { formatDataLonga } from '@/lib/messaging/time'
import { cn } from '@/lib/utils'

interface Props {
  protese: Prosthetic
  hojeYmd: string
  ocupado?: boolean
  onAbrir: () => void
  onMover?: (para: ProstheticStatus) => void
  mostrarEtapa?: boolean
}

export function CartaoProtese({ protese: p, hojeYmd, ocupado, onAbrir, onMover, mostrarEtapa }: Props) {
  const [menu, setMenu] = useState(false)
  const atraso = diasDeAtraso(p, hojeYmd)
  const idas = idasAoLab(p.events ?? [])
  const proxima = proximaEtapa(p.status)
  const acao = acaoProxima(p.status)
  const lab = p.lab?.name ?? p.laboratory
  const tipoDente = [p.type, p.tooth_region ? `dente ${p.tooth_region}` : null].filter(Boolean).join(' · ')
  const atual = etapa(p.status)

  return (
    <div
      onClick={onAbrir}
      className={cn(
        'bg-white rounded-lg border border-linha p-3 text-left cursor-pointer hover:border-linha-forte',
        atraso > 0 && 'ring-2 ring-red-300',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-tinta truncate">{p.patient?.name ?? 'Paciente'}</p>
        {idas >= 2 && (
          <span className="shrink-0 text-[11px] font-medium px-1.5 py-0.5 rounded bg-gengiva-50 text-gengiva-escuro">{idas}ª ida</span>
        )}
      </div>
      {mostrarEtapa && (
        <p className="flex items-center gap-1.5 text-xs text-tinta-2 mt-1">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: atual.cor }} />
          {atual.rotulo}
        </p>
      )}
      {tipoDente && <p className="text-xs text-tinta-2 mt-1">{tipoDente}</p>}
      {lab && <p className="text-xs text-tinta-3 mt-0.5">{lab}</p>}
      {p.professional?.name && <p className="text-xs text-tinta-3 mt-0.5">{p.professional.name}</p>}
      {p.expected_at && <p className="text-xs text-tinta-3 mt-0.5">Previsão: {formatDataLonga(p.expected_at)}</p>}
      {atraso > 0 && (
        <p className="text-xs font-medium text-red-600 mt-1">Atrasada {atraso} {atraso === 1 ? 'dia' : 'dias'}</p>
      )}

      {onMover && (
        <div className="flex items-center gap-2 mt-3 relative" onClick={(e) => e.stopPropagation()}>
          {proxima && acao && (
            <button type="button" disabled={ocupado} onClick={() => onMover(proxima)}
              className="flex-1 h-8 rounded-lg bg-petroleo text-white text-xs font-medium hover:bg-petroleo-escuro disabled:opacity-50">
              {acao}
            </button>
          )}
          <button type="button" disabled={ocupado} onClick={() => setMenu((m) => !m)} aria-label="Mais etapas"
            className="h-8 w-8 flex items-center justify-center rounded-lg border border-linha text-tinta-3 hover:bg-porcelana disabled:opacity-50">
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {menu && (
            <ul className="absolute right-0 bottom-9 z-10 w-44 bg-white rounded-lg border border-linha shadow-lg py-1">
              {ETAPAS.filter((e) => e.id !== p.status).map((e) => (
                <li key={e.id}>
                  <button type="button" disabled={ocupado}
                    onClick={() => { setMenu(false); onMover(e.id) }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-tinta hover:bg-porcelana disabled:opacity-50">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: e.cor }} />
                    {e.curto}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
