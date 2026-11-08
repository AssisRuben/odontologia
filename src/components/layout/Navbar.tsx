'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Menu, X, Settings, User, Stethoscope,
  Calendar, Users, DollarSign, Package, Layers, FileText, MessageSquare, ClipboardList, ShieldCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import type { Pendencia } from '@/lib/convenios/pendencias'
import { BuscaRapida } from './BuscaRapida'
import { SinoPendencias } from './SinoPendencias'

const navLinks = [
  { label: 'Agenda',        href: '/agenda',        icon: Calendar },
  { label: 'Pacientes',     href: '/pacientes',     icon: Users },
  { label: 'Orçamentos',    href: '/orcamentos',    icon: ClipboardList },
  { label: 'Financeiro',    href: '/financeiro',    icon: DollarSign },
  { label: 'Convênios',     href: '/convenios',     icon: ShieldCheck },
  { label: 'Prótese',       href: '/protese',       icon: Layers },
  { label: 'Estoque',       href: '/estoque',       icon: Package },
  { label: 'Mensagens',     href: '/mensagens',     icon: MessageSquare },
  { label: 'Relatórios',    href: '/relatorios',    icon: FileText },
  { label: 'Configurações', href: '/configuracoes', icon: Settings },
]

const desktopPrimary  = navLinks.slice(0, 5)   // Agenda, Pacientes, Orçamentos, Financeiro, Convênios
const bottomNavLinks  = navLinks.filter((l) => ['/agenda', '/pacientes', '/financeiro'].includes(l.href))
const secondaryLinks  = navLinks.filter((l) => !bottomNavLinks.includes(l))  // itens do "Mais"

export function Navbar() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { clinicId } = useClinicStore()
  const [approvedBadge, setApprovedBadge] = useState(0)
  const [pendingChats, setPendingChats] = useState(0)
  const [convenioCount, setConvenioCount] = useState(0)
  const [convenioItens, setConvenioItens] = useState<Pendencia[]>([])

  // Orçamentos aprovados nos últimos 30 dias que a recepção ainda não viu.
  const refreshBadge = useCallback(async () => {
    if (!clinicId) return
    const since = new Date(Date.now() - 30 * 86400000).toISOString()
    const { count } = await createClient().from('budgets')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId).eq('status', 'approved')
      .is('approval_seen_at', null).gte('decided_at', since)
    setApprovedBadge(count ?? 0)
  }, [clinicId])

  useEffect(() => { refreshBadge() }, [refreshBadge, pathname])
  useEffect(() => {
    window.addEventListener('orcamentos:seen', refreshBadge)
    return () => window.removeEventListener('orcamentos:seen', refreshBadge)
  }, [refreshBadge])

  // Conversas do WhatsApp aguardando a recepção.
  const refreshChats = useCallback(async () => {
    if (!clinicId) return
    try {
      const res = await fetch('/api/conversas/pendentes', { cache: 'no-store' })
      if (!res.ok) return
      const json = await res.json()
      setPendingChats(typeof json.total === 'number' ? json.total : 0)
    } catch { /* mantém o valor anterior */ }
  }, [clinicId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshChats()
    const t = setInterval(() => { if (document.visibilityState === 'visible') refreshChats() }, 30_000)
    window.addEventListener('conversas:seen', refreshChats)
    return () => { clearInterval(t); window.removeEventListener('conversas:seen', refreshChats) }
  }, [refreshChats, pathname])

  // Pendências de convênio (tratamentos sem faturar e lotes com prazo curto).
  const refreshConvenios = useCallback(async () => {
    if (!clinicId) return
    try {
      const res = await fetch('/api/convenios/pendencias', { cache: 'no-store' })
      if (!res.ok) return
      const json = await res.json()
      setConvenioCount(typeof json.contador === 'number' ? json.contador : 0)
      setConvenioItens(Array.isArray(json.itens) ? json.itens : [])
    } catch { /* mantém o valor anterior */ }
  }, [clinicId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshConvenios()
    const t = setInterval(() => { if (document.visibilityState === 'visible') refreshConvenios() }, 30_000)
    window.addEventListener('convenios:changed', refreshConvenios)
    return () => { clearInterval(t); window.removeEventListener('convenios:changed', refreshConvenios) }
  }, [refreshConvenios, pathname])

  const badgeFor = (href: string) =>
    href === '/orcamentos' ? approvedBadge : href === '/mensagens' ? pendingChats : href === '/convenios' ? convenioCount : 0
  // O que o botão "Mais" (celular) esconde: mensagens e convênios não estão na barra de baixo.
  const maisBadge = pendingChats + convenioCount

  return (
    <>
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-40 h-14 bg-white border-b border-[#E5E7EB]">
        <div className="flex items-center h-full px-4 gap-2">
          {/* Logo */}
          <Link href="/agenda" className="flex items-center gap-2 mr-4 shrink-0">
            <div className="w-8 h-8 bg-[#3B82F6] rounded-lg flex items-center justify-center">
              <Stethoscope className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-[#111827] text-lg">Dental</span>
          </Link>

          {/* Desktop nav links */}
          <nav className="hidden md:flex items-center gap-1 flex-1">
            {desktopPrimary.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
                  pathname.startsWith(link.href)
                    ? 'text-[#3B82F6] bg-[#EFF6FF]'
                    : 'text-[#6B7280] hover:text-[#111827] hover:bg-[#F3F4F6]'
                )}
              >
                {link.label}
                {badgeFor(link.href) > 0 && (
                  <span className="ml-1.5 inline-flex min-w-4 h-4 px-1 items-center justify-center rounded-full bg-[#EF4444] text-white text-[10px] font-bold">
                    {badgeFor(link.href)}
                  </span>
                )}
              </Link>
            ))}
          </nav>

          {/* Desktop right icons */}
          <div className="hidden md:flex items-center gap-1 ml-auto">
            <BuscaRapida />
            <SinoPendencias
              conversas={pendingChats}
              orcamentosAprovados={approvedBadge}
              convenios={{ contador: convenioCount, itens: convenioItens }}
            />
            <Link
              href="/mensagens"
              className="relative p-2 rounded-md text-[#6B7280] hover:bg-[#F3F4F6] transition-colors"
              aria-label={pendingChats > 0 ? `Mensagens: ${pendingChats} conversa(s) aguardando` : 'Mensagens'}
            >
              <MessageSquare className="w-4 h-4" />
              {pendingChats > 0 && <CountBadge value={pendingChats} />}
            </Link>
            <Link href="/configuracoes" className="p-2 rounded-md text-[#6B7280] hover:bg-[#F3F4F6] transition-colors">
              <Settings className="w-4 h-4" />
            </Link>
            <button className="w-8 h-8 rounded-full bg-[#3B82F6] flex items-center justify-center text-white ml-1">
              <User className="w-4 h-4" />
            </button>
          </div>

          {/* Mobile right side — só busca + avatar + "Mais" */}
          <div className="flex items-center gap-1 ml-auto md:hidden">
            <BuscaRapida />
            <button className="w-8 h-8 rounded-full bg-[#3B82F6] flex items-center justify-center text-white">
              <User className="w-4 h-4" />
            </button>
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="relative p-2 rounded-md text-[#6B7280] hover:bg-[#F3F4F6] transition-colors"
              aria-label={maisBadge > 0 ? `Mais opções: ${maisBadge} pendência(s)` : 'Mais opções'}
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              {!mobileOpen && maisBadge > 0 && <CountBadge value={maisBadge} />}
            </button>
          </div>
        </div>
      </header>

      {/* ── Mobile "Mais" drawer (itens secundários) ────────────────────── */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/30 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed top-14 left-0 right-0 z-30 bg-white border-b border-[#E5E7EB] shadow-lg md:hidden">
            <nav className="p-3 grid grid-cols-2 gap-1">
              {secondaryLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-colors',
                    pathname.startsWith(link.href)
                      ? 'text-[#3B82F6] bg-[#EFF6FF]'
                      : 'text-[#374151] hover:bg-[#F3F4F6]'
                  )}
                >
                  <link.icon className="w-4 h-4 shrink-0" />
                  {link.label}
                  {badgeFor(link.href) > 0 && (
                    <span className="inline-flex min-w-4 h-4 px-1 items-center justify-center rounded-full bg-[#EF4444] text-white text-[10px] font-bold">
                      {badgeFor(link.href)}
                    </span>
                  )}
                </Link>
              ))}
            </nav>
          </div>
        </>
      )}

      {/* ── Bottom navigation bar — mobile only ─────────────────────────── */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 h-16 bg-white border-t border-[#E5E7EB] flex md:hidden shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
        {bottomNavLinks.map((link) => {
          const active = pathname.startsWith(link.href)
          return (
            <Link
              key={link.href}
              href={link.href}
              className="flex-1 flex flex-col items-center justify-center gap-1 transition-colors"
            >
              <div className={cn(
                'w-10 h-7 flex items-center justify-center rounded-full transition-colors',
                active ? 'bg-[#EFF6FF]' : ''
              )}>
                <link.icon className={cn('w-5 h-5', active ? 'text-[#3B82F6]' : 'text-[#9CA3AF]')} />
              </div>
              <span className={cn(
                'text-[10px] font-medium leading-none',
                active ? 'text-[#3B82F6]' : 'text-[#9CA3AF]'
              )}>
                {link.label}
              </span>
            </Link>
          )
        })}
        {/* "Mais" abre o drawer secundário */}
        <button
          onClick={() => setMobileOpen(v => !v)}
          className="flex-1 flex flex-col items-center justify-center gap-1 transition-colors"
        >
          <div className="relative w-10 h-7 flex items-center justify-center rounded-full">
            <Menu className="w-5 h-5 text-[#9CA3AF]" />
            {maisBadge > 0 && <CountBadge value={maisBadge} />}
          </div>
          <span className="text-[10px] font-medium leading-none text-[#9CA3AF]">Mais</span>
        </button>
      </nav>
    </>
  )
}

/** Número vermelho sobre um ícone (ex.: conversas aguardando a recepção). */
function CountBadge({ value }: { value: number }) {
  return (
    <span className="absolute -top-0.5 -right-0.5 inline-flex min-w-4 h-4 px-1 items-center justify-center rounded-full bg-[#EF4444] text-white text-[10px] font-bold">
      {value > 99 ? '99+' : value}
    </span>
  )
}
