'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Menu, X, Search, Bell, Settings, User, Stethoscope,
  Calendar, Users, DollarSign, Package, Layers, FileText, MessageSquare,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navLinks = [
  { label: 'Agenda',        href: '/agenda',        icon: Calendar },
  { label: 'Pacientes',     href: '/pacientes',     icon: Users },
  { label: 'Financeiro',    href: '/financeiro',    icon: DollarSign },
  { label: 'Prótese',       href: '/protese',       icon: Layers },
  { label: 'Estoque',       href: '/estoque',       icon: Package },
  { label: 'Mensagens',     href: '/mensagens',     icon: MessageSquare },
  { label: 'Relatórios',    href: '/relatorios',    icon: FileText },
  { label: 'Configurações', href: '/configuracoes', icon: Settings },
]

const desktopPrimary  = navLinks.slice(0, 3)
const bottomNavLinks  = navLinks.slice(0, 3)   // Agenda, Pacientes, Financeiro
const secondaryLinks  = navLinks.slice(3)       // itens do "Mais"

export function Navbar() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

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
              </Link>
            ))}
          </nav>

          {/* Desktop right icons */}
          <div className="hidden md:flex items-center gap-1 ml-auto">
            <button className="p-2 rounded-md text-[#6B7280] hover:bg-[#F3F4F6] transition-colors">
              <Search className="w-4 h-4" />
            </button>
            <button className="p-2 rounded-md text-[#6B7280] hover:bg-[#F3F4F6] transition-colors">
              <Bell className="w-4 h-4" />
            </button>
            <Link href="/mensagens" className="p-2 rounded-md text-[#6B7280] hover:bg-[#F3F4F6] transition-colors">
              <MessageSquare className="w-4 h-4" />
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
            <button className="p-2 rounded-md text-[#6B7280] hover:bg-[#F3F4F6]">
              <Search className="w-4 h-4" />
            </button>
            <button className="w-8 h-8 rounded-full bg-[#3B82F6] flex items-center justify-center text-white">
              <User className="w-4 h-4" />
            </button>
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="p-2 rounded-md text-[#6B7280] hover:bg-[#F3F4F6] transition-colors"
              aria-label="Mais opções"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
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
          <div className="w-10 h-7 flex items-center justify-center rounded-full">
            <Menu className="w-5 h-5 text-[#9CA3AF]" />
          </div>
          <span className="text-[10px] font-medium leading-none text-[#9CA3AF]">Mais</span>
        </button>
      </nav>
    </>
  )
}
