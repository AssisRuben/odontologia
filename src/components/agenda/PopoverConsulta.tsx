'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { topoDentroDaJanela } from '@/lib/ui/posicaoMenu'
import Link from 'next/link'
import { X, Calendar, User2, Phone, FileText, Edit2, ExternalLink, ClipboardPlus, CheckCircle2, Check, CheckCheck, MessageCircle, ChevronDown } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { formatPhone } from '@/lib/utils'
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_STATUS_COLORS } from '@/types'
import type { Appointment, AppointmentStatus } from '@/types'
import { createClient } from '@/lib/supabase/client'
import type { WhatsAppIndicator } from './useWhatsAppStatus'

interface PopoverConsultaProps {
  appointment: Appointment
  anchorRect: DOMRect
  onClose: () => void
  onEdit: () => void
  onAddEvolucao: () => void
  /** Situação da consulta mudou (pela lista ou pelo "Confirmar consulta"): recarregar a agenda. */
  onStatusChanged?: () => void
  whatsapp?: WhatsAppIndicator
}

export function PopoverConsulta({ appointment: apt, anchorRect, onClose, onEdit, onAddEvolucao, onStatusChanged, whatsapp }: PopoverConsultaProps) {
  const popRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<AppointmentStatus>(apt.status)
  const [salvando, setSalvando] = useState(false)
  const [erroStatus, setErroStatus] = useState('')

  // Muda a situação na hora; se o banco recusar, volta a anterior e avisa.
  async function mudarStatus(novo: AppointmentStatus) {
    if (novo === status) return
    const anterior = status
    setStatus(novo)
    setErroStatus('')
    setSalvando(true)
    const { error } = await createClient().from('appointments').update({ status: novo }).eq('id', apt.id)
    setSalvando(false)
    if (error) {
      setStatus(anterior)
      setErroStatus('Não foi possível mudar a situação. Tente de novo.')
      return
    }
    onStatusChanged?.()
  }

  // Fecha ao clicar fora
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // pequeno delay para não fechar imediatamente ao abrir
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 50)
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handleClick) }
  }, [onClose])

  // Fecha com Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Ao lado da consulta: à direita se couber, senão à esquerda
  const popW = 300
  const margin = 10
  const vw = window.innerWidth

  let left = anchorRect.right + margin
  if (left + popW > vw - margin) left = anchorRect.left - popW - margin
  if (left < margin) left = margin

  // Na altura da consulta, subindo o que for preciso para o fim do popup não sair da janela.
  // A altura varia (observação, botões), então é medida antes de o popup aparecer.
  useLayoutEffect(() => {
    const pop = popRef.current
    if (!pop) return
    pop.style.top = `${topoDentroDaJanela(anchorRect.top, pop.offsetHeight, window.innerHeight)}px`
    pop.style.visibility = 'visible'
  }, [anchorRect, status, erroStatus])

  const statusColor = APPOINTMENT_STATUS_COLORS[status] || '#5E6E75'

  return (
    <div
      ref={popRef}
      className="invisible fixed z-50 bg-white rounded-xl shadow-2xl border border-linha overflow-x-hidden overflow-y-auto max-h-[calc(100vh-16px)]"
      style={{ left, width: popW }}
    >
      {/* Faixa colorida de status no topo */}
      <div className="h-1 w-full" style={{ backgroundColor: statusColor }} />

      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {/* Situação da consulta: a etiqueta é uma lista para trocar ali mesmo */}
              <label className="relative inline-flex items-center rounded-full" style={{ backgroundColor: statusColor + '20', color: statusColor }}>
                <span className="sr-only">Situação da consulta</span>
                <select
                  value={status}
                  disabled={salvando}
                  onChange={(e) => mudarStatus(e.target.value as AppointmentStatus)}
                  title="Mudar situação"
                  className="appearance-none cursor-pointer bg-transparent pl-2 pr-6 py-0.5 rounded-full text-xs font-semibold text-current focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current disabled:cursor-wait disabled:opacity-60"
                >
                  {(Object.keys(APPOINTMENT_STATUS_LABELS) as AppointmentStatus[]).map((s) => (
                    <option key={s} value={s} className="text-tinta bg-white">{APPOINTMENT_STATUS_LABELS[s]}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-1.5 w-3 h-3" />
              </label>
            </div>
            {erroStatus && <p role="alert" className="mb-1 text-xs text-red-600">{erroStatus}</p>}
            <h3 className="text-sm font-bold text-tinta leading-snug truncate">
              {apt.patient_id ? (
                <Link
                  href={`/pacientes/${apt.patient_id}`}
                  onClick={onClose}
                  title="Abrir prontuário"
                  className="rounded-sm hover:text-petroleo hover:underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-petroleo"
                >
                  {apt.patient?.name || 'Paciente'}
                </Link>
              ) : (apt.patient?.name || 'Paciente')}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-tinta-4 hover:text-tinta-2 hover:bg-porcelana transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Detalhes */}
        <div className="space-y-2">
          <InfoLine icon={<Calendar className="w-3.5 h-3.5" />}>
            {format(parseISO(apt.start_time), "EEE, d 'de' MMM · HH:mm", { locale: ptBR })}
            {' – '}
            {format(parseISO(apt.end_time), 'HH:mm', { locale: ptBR })}
          </InfoLine>

          {apt.procedure && (
            <InfoLine icon={<FileText className="w-3.5 h-3.5" />}>
              {apt.procedure}
            </InfoLine>
          )}

          {apt.professional && (
            <InfoLine icon={<User2 className="w-3.5 h-3.5" />}>
              {apt.professional.name}
            </InfoLine>
          )}

          {apt.patient?.insurance_plan && (
            <InfoLine icon={<FileText className="w-3.5 h-3.5" />}>
              {apt.patient.insurance_plan.name}
            </InfoLine>
          )}

          {apt.patient?.phone && (
            <InfoLine icon={<Phone className="w-3.5 h-3.5" />}>
              {formatPhone(apt.patient.phone)}
            </InfoLine>
          )}

          {whatsapp === 'confirmed' && (
            <div className="flex items-center gap-2 text-xs font-medium text-[#16A34A]">
              <CheckCheck className="w-3.5 h-3.5 shrink-0" />
              Confirmada pelo WhatsApp
            </div>
          )}
          {whatsapp === 'sent' && (
            <div className="flex items-center gap-2 text-xs text-tinta-3">
              <Check className="w-3.5 h-3.5 shrink-0" />
              Confirmação enviada
            </div>
          )}

          {apt.source === 'whatsapp' && (
            <div className="flex items-center gap-2 text-xs text-tinta-3">
              <MessageCircle className="w-3.5 h-3.5 shrink-0" />
              Marcada pelo WhatsApp
            </div>
          )}

          {apt.notes && (
            <p className="text-xs text-tinta-3 italic border-t border-porcelana pt-2 mt-2">
              {apt.notes}
            </p>
          )}
        </div>

        {/* Ações */}
        <div className="mt-4 pt-3 border-t border-porcelana space-y-2">

          {/* Confirmar consulta (só para agendada) */}
          {status === 'confirmed' ? (
            <div className="w-full flex items-center justify-center gap-1.5 h-8 rounded-lg bg-[#DCFCE7] text-[#16A34A] text-xs font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Consulta confirmada
            </div>
          ) : status === 'scheduled' ? (
            <button
              onClick={() => mudarStatus('confirmed')}
              disabled={salvando}
              className="w-full flex items-center justify-center gap-1.5 h-8 rounded-lg bg-petroleo text-white text-xs font-semibold hover:bg-petroleo-escuro transition-colors disabled:opacity-60"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {salvando ? 'Confirmando...' : 'Confirmar consulta'}
            </button>
          ) : null}

          <button
            onClick={() => { onClose(); onAddEvolucao() }}
            className="w-full flex items-center justify-center gap-1.5 h-8 rounded-lg bg-[#10B981] text-white text-xs font-medium hover:bg-[#059669] transition-colors"
          >
            <ClipboardPlus className="w-3.5 h-3.5" />
            Adicionar evolução
          </button>
          <div className="flex gap-2">
            {apt.patient_id && (
              <Link
                href={`/pacientes/${apt.patient_id}`}
                onClick={onClose}
                className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg border border-linha text-xs font-medium text-tinta-2 hover:bg-porcelana transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Prontuário
              </Link>
            )}
            <button
              onClick={() => { onClose(); onEdit() }}
              className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg bg-[#F59E0B] text-white text-xs font-medium hover:bg-[#D97706] transition-colors"
            >
              <Edit2 className="w-3.5 h-3.5" />
              Editar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoLine({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-tinta-4 mt-0.5 shrink-0">{icon}</span>
      <span className="text-xs text-tinta-2 leading-tight">{children}</span>
    </div>
  )
}
