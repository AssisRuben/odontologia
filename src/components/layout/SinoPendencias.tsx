'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell, MessageSquare, ClipboardList, ShieldCheck, Cake, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import { aniversariantesDoDia } from '@/lib/avisos/aniversariantes'
import { todayYmd } from '@/lib/messaging/time'
import type { Pendencia } from '@/lib/convenios/pendencias'

const MAX_CONVENIOS = 5

type Props = {
  conversas: number
  orcamentosAprovados: number
  convenios: { contador: number; itens: Pendencia[] }
}

/**
 * Sino da barra do topo: junta num só lugar o que pede ação da recepção
 * (conversas, orçamentos aprovados, convênios) e os aniversariantes do dia.
 * O número do sino conta só o que pede ação; aniversário é lembrete.
 */
export function SinoPendencias({ conversas, orcamentosAprovados, convenios }: Props) {
  const { clinicId } = useClinicStore()
  const [open, setOpen] = useState(false)
  const [aniversariantes, setAniversariantes] = useState<{ id: string; name: string }[] | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const total = conversas + orcamentosAprovados + convenios.contador

  // Fecha ao clicar fora, apertar Esc ou seguir um dos links.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  // Aniversariantes: carrega ao abrir o sino.
  useEffect(() => {
    if (!open || !clinicId) return
    let cancelado = false
    createClient()
      .from('patients')
      .select('id, name, birthdate')
      .eq('clinic_id', clinicId)
      .not('birthdate', 'is', null)
      .then(({ data }) => {
        if (cancelado) return
        const hoje = todayYmd(new Date(), 'America/Sao_Paulo')
        setAniversariantes(aniversariantesDoDia(data ?? [], hoje))
      })
    return () => { cancelado = true }
  }, [open, clinicId])

  const nada = total === 0 && aniversariantes !== null && aniversariantes.length === 0

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={total > 0 ? `Pendências: ${total}` : 'Pendências'}
        title="Pendências"
        className="relative w-9 h-9 grid place-items-center rounded-[10px] bg-white text-tinta-3 ring-1 ring-inset ring-linha hover:text-tinta transition-colors"
      >
        <Bell className="w-4 h-4" />
        {total > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex min-w-4 h-4 px-1 items-center justify-center rounded-full bg-gengiva text-white text-[10px] font-bold">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {open && (
        <div
          onClick={(e) => { if ((e.target as HTMLElement).closest('a')) setOpen(false) }}
          className="absolute right-0 top-full mt-2 w-80 max-h-[70vh] overflow-y-auto bg-white rounded-xl shadow-xl border border-linha z-50">
          <p className="px-4 py-3 text-sm font-semibold text-tinta border-b border-linha">Pendências</p>

          {conversas > 0 && (
            <Linha href="/mensagens" icon={<MessageSquare className="w-4 h-4 text-petroleo" />}>
              {conversas === 1 ? '1 conversa aguardando resposta' : `${conversas} conversas aguardando resposta`}
            </Linha>
          )}

          {orcamentosAprovados > 0 && (
            <Linha href="/orcamentos" icon={<ClipboardList className="w-4 h-4 text-[#10B981]" />}>
              {orcamentosAprovados === 1
                ? '1 orçamento aprovado pelo paciente'
                : `${orcamentosAprovados} orçamentos aprovados pelos pacientes`}
            </Linha>
          )}

          {convenios.itens.length > 0 && (
            <div className="border-t border-porcelana">
              <p className="px-4 pt-3 pb-1 text-xs font-semibold text-tinta-3 uppercase tracking-wide">Convênios</p>
              {convenios.itens.slice(0, MAX_CONVENIOS).map((p, i) => (
                <Linha key={`${p.href}-${i}`} href={p.href} icon={<ShieldCheck className="w-4 h-4 text-[#F97316]" />}>
                  {p.texto}
                </Linha>
              ))}
              {convenios.itens.length > MAX_CONVENIOS && (
                <Link href="/convenios" className="block px-4 py-2 text-xs font-medium text-petroleo hover:bg-petroleo-50">
                  Ver todas as {convenios.itens.length} pendências de convênio
                </Link>
              )}
            </div>
          )}

          {aniversariantes && aniversariantes.length > 0 && (
            <div className="border-t border-porcelana">
              <p className="px-4 pt-3 pb-1 text-xs font-semibold text-tinta-3 uppercase tracking-wide">Aniversariantes de hoje</p>
              {aniversariantes.map((p) => (
                <Linha key={p.id} href={`/pacientes/${p.id}`} icon={<Cake className="w-4 h-4 text-[#F59E0B]" />}>
                  {p.name}
                </Linha>
              ))}
            </div>
          )}

          {aniversariantes === null && total === 0 && (
            <p className="px-4 py-6 text-sm text-center text-tinta-4">Carregando…</p>
          )}
          {nada && (
            <p className="px-4 py-6 text-sm text-center text-tinta-3">Nenhuma pendência no momento.</p>
          )}
        </div>
      )}
    </div>
  )
}

function Linha({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-start gap-3 px-4 py-2.5 text-sm text-tinta-2 hover:bg-porcelana-2"
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="flex-1 min-w-0">{children}</span>
      <ChevronRight className="w-4 h-4 text-linha-forte shrink-0 mt-0.5" />
    </Link>
  )
}
