'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { X, Calendar, User2, Phone, FileText, Edit2, ExternalLink, ClipboardPlus, CheckCircle2 } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { formatPhone } from '@/lib/utils'
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_STATUS_COLORS } from '@/types'
import type { Appointment } from '@/types'
import { createClient } from '@/lib/supabase/client'

interface PopoverConsultaProps {
  appointment: Appointment
  anchorRect: DOMRect
  onClose: () => void
  onEdit: () => void
  onAddEvolucao: () => void
  onConfirmed?: () => void
}

export function PopoverConsulta({ appointment: apt, anchorRect, onClose, onEdit, onAddEvolucao, onConfirmed }: PopoverConsultaProps) {
  const popRef = useRef<HTMLDivElement>(null)
  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed]   = useState(apt.status === 'confirmed')

  async function handleConfirm() {
    setConfirming(true)
    await createClient().from('appointments').update({ status: 'confirmed' }).eq('id', apt.id)
    setConfirmed(true)
    setConfirming(false)
    onConfirmed?.()
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

  // Calcula posição inteligente
  const popW = 300
  const popH = 300
  const margin = 10
  const vw = window.innerWidth
  const vh = window.innerHeight

  let left = anchorRect.right + margin
  if (left + popW > vw - margin) left = anchorRect.left - popW - margin
  if (left < margin) left = margin

  let top = anchorRect.top
  if (top + popH > vh - margin) top = vh - popH - margin
  if (top < margin) top = margin

  const statusColor = APPOINTMENT_STATUS_COLORS[apt.status] || '#6B7280'
  const statusLabel = APPOINTMENT_STATUS_LABELS[apt.status] || apt.status

  return (
    <div
      ref={popRef}
      className="fixed z-50 bg-white rounded-xl shadow-2xl border border-[#E5E7EB] overflow-hidden"
      style={{ left, top, width: popW }}
    >
      {/* Faixa colorida de status no topo */}
      <div className="h-1 w-full" style={{ backgroundColor: statusColor }} />

      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
                style={{ backgroundColor: statusColor + '20', color: statusColor }}
              >
                {statusLabel}
              </span>
            </div>
            <h3 className="text-sm font-bold text-[#111827] leading-snug truncate">
              {apt.patient?.name || 'Paciente'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[#9CA3AF] hover:text-[#374151] hover:bg-[#F3F4F6] transition-colors shrink-0"
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

          {apt.notes && (
            <p className="text-xs text-[#6B7280] italic border-t border-[#F3F4F6] pt-2 mt-2">
              {apt.notes}
            </p>
          )}
        </div>

        {/* Ações */}
        <div className="mt-4 pt-3 border-t border-[#F3F4F6] space-y-2">

          {/* Confirmar consulta */}
          {confirmed ? (
            <div className="w-full flex items-center justify-center gap-1.5 h-8 rounded-lg bg-[#DCFCE7] text-[#16A34A] text-xs font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Consulta confirmada
            </div>
          ) : (
            <button
              onClick={handleConfirm}
              disabled={confirming}
              className="w-full flex items-center justify-center gap-1.5 h-8 rounded-lg bg-[#3B82F6] text-white text-xs font-semibold hover:bg-[#2563EB] transition-colors disabled:opacity-60"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {confirming ? 'Confirmando...' : 'Confirmar consulta'}
            </button>
          )}

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
                className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg border border-[#E5E7EB] text-xs font-medium text-[#374151] hover:bg-[#F3F4F6] transition-colors"
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
      <span className="text-[#9CA3AF] mt-0.5 shrink-0">{icon}</span>
      <span className="text-xs text-[#374151] leading-tight">{children}</span>
    </div>
  )
}
