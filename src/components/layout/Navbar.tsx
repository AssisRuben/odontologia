'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Menu, X, Settings, HelpCircle, PanelLeftClose, PanelLeftOpen,
  Calendar, Users, DollarSign, Package, Layers, FileText, MessageSquare, ClipboardList, ShieldCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import { contarAprovadosNaoVistos } from '@/lib/orcamentos/aprovadosNaoVistos'
import type { Pendencia } from '@/lib/convenios/pendencias'
import { BuscaRapida } from './BuscaRapida'
import { SinoPendencias } from './SinoPendencias'
import { MenuUsuario } from './MenuUsuario'
import { LogoDente } from './LogoDente'
import { useMenuLateral } from './MenuLateral'

const navLinks = [
  { label: 'Agenda',        href: '/agenda',        icon: Calendar },
  { label: 'Pacientes',     href: '/pacientes',     icon: Users },
  { label: 'Orçamentos',    href: '/orcamentos',    icon: ClipboardList },
  { label: 'Financeiro',    href: '/financeiro',    icon: DollarSign },
  { label: 'Convênios',     href: '/convenios',     icon: ShieldCheck },
  { label: 'Mensagens',     href: '/mensagens',     icon: MessageSquare },
  { label: 'Prótese',       href: '/protese',       icon: Layers },
  { label: 'Estoque',       href: '/estoque',       icon: Package },
  { label: 'Relatórios',    href: '/relatorios',    icon: FileText },
  { label: 'Configurações', href: '/configuracoes', icon: Settings },
  { label: 'Ajuda',         href: '/ajuda',         icon: HelpCircle },
]

// Computador: menu lateral em dois grupos (dia a dia / apoio).
const sidebarPrincipal = navLinks.slice(0, 6)
const sidebarApoio     = navLinks.slice(6)
// Celular: barra de baixo com os mais usados; o resto vai no "Mais".
const bottomNavLinks   = navLinks.filter((l) => ['/agenda', '/pacientes', '/financeiro', '/mensagens'].includes(l.href))
const secondaryLinks   = navLinks.filter((l) => !bottomNavLinks.includes(l))

export function Navbar() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { clinicId, clinicName } = useClinicStore()
  const [approvedBadge, setApprovedBadge] = useState(0)
  const [pendingChats, setPendingChats] = useState(0)
  const [convenioCount, setConvenioCount] = useState(0)
  const [convenioItens, setConvenioItens] = useState<Pendencia[]>([])

  // Orçamentos aprovados nos últimos 30 dias que a recepção ainda não viu.
  const refreshBadge = useCallback(async () => {
    if (!clinicId) return
    setApprovedBadge(await contarAprovadosNaoVistos(createClient(), clinicId))
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
  // O que o botão "Mais" (celular) esconde: orçamentos e convênios não estão na barra de baixo.
  const maisBadge = approvedBadge + convenioCount

  const isActive = (href: string) => pathname.startsWith(href)

  // Menu lateral recolhido em faixa de ícones: o nome do item aparece ao lado, no mouse ou no Tab.
  const { recolhido, alternar } = useMenuLateral()
  const [dicaAtual, setDicaAtual] = useState<{ texto: string; top: number } | null>(null)
  const dica: Dica = (texto) => {
    if (!texto) return {}
    const mostrar = (e: React.SyntheticEvent<HTMLElement>) => {
      const r = e.currentTarget.getBoundingClientRect()
      setDicaAtual({ texto, top: r.top + r.height / 2 })
    }
    const esconder = () => setDicaAtual(null)
    return { onMouseEnter: mostrar, onFocus: mostrar, onMouseLeave: esconder, onBlur: esconder }
  }

  return (
    <>
      {/* ── Menu lateral — computador ───────────────────────────────────── */}
      <aside
        className={cn(
          'hidden md:flex fixed inset-y-0 left-0 z-40 flex-col overflow-hidden bg-petroleo text-[#C9D8DC] pt-4 pb-3',
          'motion-safe:transition-[width] motion-safe:duration-200',
          recolhido ? 'w-16 px-2.5' : 'w-[220px] px-3'
        )}
        aria-label="Menu principal"
      >
        <Link
          href="/agenda"
          aria-label={recolhido ? 'Ir para a agenda' : undefined}
          className={cn(
            'flex items-center gap-2.5 pb-5 rounded-lg focus-visible:outline-2 focus-visible:outline-gengiva',
            recolhido ? 'justify-center px-0' : 'px-2'
          )}
        >
          <LogoDente />
          {!recolhido && (
            <span className="min-w-0">
              <span className="block font-display text-[21px] leading-none font-bold tracking-tight text-white">Dental</span>
              {clinicName && <span className="block mt-1 text-xs text-[#93AEB5] truncate">{clinicName}</span>}
            </span>
          )}
        </Link>

        <nav className="flex-1 overflow-y-auto overflow-x-hidden -mx-1 px-1">
          {sidebarPrincipal.map((link) => (
            <SidebarLink key={link.href} link={link} active={isActive(link.href)} badge={badgeFor(link.href)} recolhido={recolhido} dica={dica} />
          ))}
          <hr className="border-0 border-t border-white/10 my-3 mx-2" />
          {sidebarApoio.map((link) => (
            <SidebarLink key={link.href} link={link} active={isActive(link.href)} badge={badgeFor(link.href)} recolhido={recolhido} dica={dica} />
          ))}
        </nav>

        <button
          type="button"
          onClick={() => { setDicaAtual(null); alternar() }}
          aria-expanded={!recolhido}
          aria-label={recolhido ? 'Expandir menu' : undefined}
          className={cn(
            'flex items-center gap-3 mt-2 py-2 rounded-[9px] text-sm font-medium text-[#93AEB5] transition-colors',
            'hover:bg-white/[.07] hover:text-white focus-visible:outline-2 focus-visible:outline-gengiva',
            recolhido ? 'justify-center px-0' : 'px-2.5'
          )}
          {...dica(recolhido ? 'Expandir menu' : null)}
        >
          {recolhido
            ? <PanelLeftOpen className="w-[17px] h-[17px] shrink-0" />
            : <PanelLeftClose className="w-[17px] h-[17px] shrink-0" />}
          {!recolhido && <span className="whitespace-nowrap">Recolher menu</span>}
        </button>

        {/* Nome do item ao lado da faixa de ícones (fora do <nav> para não ser cortado pela rolagem) */}
        {recolhido && dicaAtual && (
          <span
            role="tooltip"
            className="pointer-events-none fixed left-[72px] z-50 -translate-y-1/2 whitespace-nowrap rounded-md bg-tinta px-2.5 py-1.5 text-xs font-medium text-white shadow-lg"
            style={{ top: dicaAtual.top }}
          >
            {dicaAtual.texto}
          </span>
        )}
      </aside>

      {/* ── Barra de topo ───────────────────────────────────────────────── */}
      <header className={cn(
        'fixed top-0 right-0 left-0 z-30 h-14 bg-porcelana/90 backdrop-blur border-b border-linha',
        'motion-safe:transition-[left] motion-safe:duration-200',
        recolhido ? 'md:left-16' : 'md:left-[220px]'
      )}>
        <div className="flex items-center h-full px-4 md:px-6 gap-2">
          {/* Logo — só no celular (no computador está no menu lateral) */}
          <Link href="/agenda" className="flex items-center gap-2 mr-2 shrink-0 md:hidden">
            <LogoDente size={30} />
            <span className="font-display font-bold text-tinta text-lg tracking-tight">Dental</span>
          </Link>

          <BuscaRapida variante="campo" className="hidden md:flex" />

          {/* Direita — computador */}
          <div className="hidden md:flex items-center gap-1.5 ml-auto">
            <SinoPendencias
              conversas={pendingChats}
              orcamentosAprovados={approvedBadge}
              convenios={{ contador: convenioCount, itens: convenioItens }}
            />
            <MenuUsuario />
          </div>

          {/* Direita — celular: busca + avatar */}
          <div className="flex items-center gap-1 ml-auto md:hidden">
            <BuscaRapida />
            <MenuUsuario />
          </div>
        </div>
      </header>

      {/* ── Gaveta "Mais" — celular ─────────────────────────────────────── */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-30 bg-tinta/30 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed bottom-16 left-0 right-0 z-30 bg-white rounded-t-2xl border-t border-linha shadow-xl md:hidden">
            <nav className="p-3 grid grid-cols-2 gap-1">
              {secondaryLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-colors',
                    isActive(link.href)
                      ? 'text-petroleo bg-petroleo-50'
                      : 'text-tinta-2 hover:bg-porcelana'
                  )}
                >
                  <link.icon className="w-4 h-4 shrink-0" />
                  {link.label}
                  {badgeFor(link.href) > 0 && (
                    <span className="inline-flex min-w-4 h-4 px-1 items-center justify-center rounded-full bg-gengiva text-white text-[10px] font-bold">
                      {badgeFor(link.href)}
                    </span>
                  )}
                </Link>
              ))}
            </nav>
          </div>
        </>
      )}

      {/* ── Barra de baixo — celular ────────────────────────────────────── */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 h-16 bg-white border-t border-linha flex md:hidden">
        {bottomNavLinks.map((link) => {
          const active = isActive(link.href)
          const badge = badgeFor(link.href)
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? 'page' : undefined}
              className="flex-1 flex flex-col items-center justify-center gap-1 transition-colors"
            >
              <div className={cn(
                'relative w-11 h-7 flex items-center justify-center rounded-full transition-colors',
                active ? 'bg-petroleo-50' : ''
              )}>
                <link.icon className={cn('w-5 h-5', active ? 'text-petroleo' : 'text-tinta-4')} />
                {badge > 0 && <CountBadge value={badge} />}
              </div>
              <span className={cn(
                'text-[10px] leading-none',
                active ? 'text-petroleo font-bold' : 'text-tinta-4 font-medium'
              )}>
                {link.label}
              </span>
            </Link>
          )
        })}
        {/* "Mais" abre a gaveta com os outros itens */}
        <button
          onClick={() => setMobileOpen(v => !v)}
          aria-expanded={mobileOpen}
          aria-label={maisBadge > 0 ? `Mais opções: ${maisBadge} pendência(s)` : 'Mais opções'}
          className="flex-1 flex flex-col items-center justify-center gap-1 transition-colors"
        >
          <div className="relative w-11 h-7 flex items-center justify-center rounded-full">
            {mobileOpen ? <X className="w-5 h-5 text-tinta-3" /> : <Menu className="w-5 h-5 text-tinta-4" />}
            {!mobileOpen && maisBadge > 0 && <CountBadge value={maisBadge} />}
          </div>
          <span className="text-[10px] font-medium leading-none text-tinta-4">Mais</span>
        </button>
      </nav>
    </>
  )
}

type NavLink = (typeof navLinks)[number]

/** Eventos que mostram/escondem o nome do item ao lado da faixa de ícones (vazio quando não há dica). */
type Dica = (texto: string | null) => Partial<Record<'onMouseEnter' | 'onFocus' | 'onMouseLeave' | 'onBlur', React.EventHandler<React.SyntheticEvent<HTMLElement>>>>

/** Item do menu lateral (fundo claro quando é a página atual). Recolhido, mostra só o ícone. */
function SidebarLink({ link, active, badge, recolhido, dica }: {
  link: NavLink; active: boolean; badge: number; recolhido: boolean; dica: Dica
}) {
  const nome = badge > 0 ? `${link.label} (${badge > 99 ? '99+' : badge})` : link.label
  return (
    <Link
      href={link.href}
      aria-current={active ? 'page' : undefined}
      aria-label={recolhido ? nome : undefined}
      className={cn(
        'flex items-center gap-3 py-2 my-0.5 rounded-[9px] text-sm transition-colors',
        'focus-visible:outline-2 focus-visible:outline-gengiva',
        recolhido ? 'justify-center px-0' : 'px-2.5',
        active
          ? 'bg-porcelana-2 text-petroleo font-semibold'
          : 'font-medium hover:bg-white/[.07] hover:text-white'
      )}
      {...dica(recolhido ? nome : null)}
    >
      <span className="relative shrink-0">
        <link.icon className={cn('w-[17px] h-[17px]', active ? 'opacity-100' : 'opacity-80')} />
        {recolhido && badge > 0 && (
          <span className="absolute -top-2 -right-2.5 inline-flex min-w-4 h-4 px-1 items-center justify-center rounded-full bg-gengiva text-white text-[10px] font-bold tabular-nums">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
      {!recolhido && <span className="truncate whitespace-nowrap">{link.label}</span>}
      {!recolhido && badge > 0 && (
        <span className="ml-auto min-w-5 px-1.5 py-px rounded-full bg-gengiva text-white text-[11px] font-bold text-center tabular-nums">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  )
}

/** Número vermelho sobre um ícone (ex.: conversas aguardando a recepção). */
function CountBadge({ value }: { value: number }) {
  return (
    <span className="absolute -top-0.5 -right-0.5 inline-flex min-w-4 h-4 px-1 items-center justify-center rounded-full bg-gengiva text-white text-[10px] font-bold">
      {value > 99 ? '99+' : value}
    </span>
  )
}
