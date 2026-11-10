'use client'

import type { ReactNode } from 'react'
import { X } from 'lucide-react'

export const inputCls = 'w-full h-10 px-3 rounded-lg border border-linha text-sm bg-white focus:outline-none focus:ring-2 focus:ring-petroleo'
export const labelCls = 'block text-sm font-medium text-tinta mb-1'
export const btnSecCls = 'px-4 py-2 rounded-lg border border-linha text-sm text-tinta hover:bg-porcelana-2 disabled:opacity-50'
export const btnPriCls = 'px-4 py-2 rounded-lg bg-petroleo text-white text-sm font-medium hover:bg-petroleo-escuro disabled:opacity-50'

interface Props {
  titulo: string
  onClose: () => void
  bloqueado?: boolean
  largo?: boolean
  rodape?: ReactNode
  children: ReactNode
}

/** Casca comum das janelas de estoque: fundo, cabeçalho, corpo e rodapé. */
export function ModalBase({ titulo, onClose, bloqueado, largo, rodape, children }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={bloqueado ? undefined : onClose} />
      <div className={`relative bg-white rounded-xl shadow-xl w-full ${largo ? 'max-w-2xl' : 'max-w-lg'} mx-4 max-h-[92vh] overflow-y-auto`}>
        <div className="flex items-center justify-between p-5 border-b border-linha">
          <h2 className="text-base font-semibold text-tinta">{titulo}</h2>
          <button onClick={onClose} disabled={bloqueado} className="p-1 rounded text-tinta-4 hover:text-tinta-2" aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
        {rodape && <div className="flex justify-end gap-2 p-5 border-t border-linha">{rodape}</div>}
      </div>
    </div>
  )
}

export function CaixaErro({ children }: { children: ReactNode }) {
  return <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{children}</div>
}
