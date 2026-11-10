'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ItemMenu = { label: string; href: string; icon: LucideIcon }

/** Botão "Mais" do topo (computador): abre os itens que não cabem na barra. */
export function MenuMais({ itens, pathname }: { itens: ItemMenu[]; pathname: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const ativo = itens.some((i) => pathname.startsWith(i.href))

  // Fecha ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
          ativo ? 'text-[#3B82F6] bg-[#EFF6FF]' : 'text-[#6B7280] hover:text-[#111827] hover:bg-[#F3F4F6]',
        )}
      >
        Mais
        <ChevronDown className={cn('w-4 h-4 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-2 w-52 bg-white rounded-xl shadow-xl border border-[#E5E7EB] z-50 overflow-hidden py-1"
        >
          {itens.map(({ label, href, icon: Icon }) => {
            const atual = pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[#F9FAFB]',
                  atual ? 'text-[#3B82F6] font-medium' : 'text-[#374151]',
                )}
              >
                <Icon className={cn('w-4 h-4', atual ? 'text-[#3B82F6]' : 'text-[#6B7280]')} />
                {label}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
