'use client'

import { useState, useEffect } from 'react'
import { format, parseISO } from 'date-fns'
import { X, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ClockPicker } from './ClockPicker'
import type { Appointment, Professional, AppointmentStatus } from '@/types'

function toLocalISO(date: string, time: string): string {
  const off  = new Date().getTimezoneOffset()
  const sign = off <= 0 ? '+' : '-'
  const hh   = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')
  const mm   = String(Math.abs(off) % 60).padStart(2, '0')
  return `${date}T${time}:00${sign}${hh}:${mm}`
}

function localDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function localTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

interface ModalEditarConsultaProps {
  open: boolean
  appointment: Appointment
  professionals: Professional[]
  onClose: () => void
  onSaved: () => void
}

const statusOptions: { value: AppointmentStatus; label: string }[] = [
  { value: 'scheduled',   label: 'Agendado' },
  { value: 'confirmed',   label: 'Confirmado' },
  { value: 'waiting',     label: 'Aguardando' },
  { value: 'in_progress', label: 'Em atendimento' },
  { value: 'completed',   label: 'Concluído' },
  { value: 'cancelled',   label: 'Cancelado' },
  { value: 'no_show',     label: 'Faltou' },
]

export function ModalEditarConsulta({
  open, appointment: apt, professionals, onClose, onSaved,
}: ModalEditarConsultaProps) {
  const [professionalId, setProfessionalId] = useState(apt.professional_id || professionals[0]?.id || '')
  const [date, setDate]           = useState(localDate(apt.start_time))
  const [startTime, setStartTime] = useState(localTime(apt.start_time))
  const [endTime, setEndTime]     = useState(localTime(apt.end_time))
  const [procedure, setProcedure] = useState(apt.procedure || '')
  const [notes, setNotes]         = useState(apt.notes || '')
  const [status, setStatus]       = useState<AppointmentStatus>(apt.status)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [activePicker, setActivePicker] = useState<'start' | 'end' | null>(null)

  useEffect(() => {
    if (!open) return
    setProfessionalId(apt.professional_id || professionals[0]?.id || '')
    setDate(localDate(apt.start_time))
    setStartTime(localTime(apt.start_time))
    setEndTime(localTime(apt.end_time))
    setProcedure(apt.procedure || '')
    setNotes(apt.notes || '')
    setStatus(apt.status)
    setLoading(false)
    setError('')
    setConfirmDelete(false)
    setActivePicker(null)
  }, [apt.id, open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const supabase = createClient()
    const { error: updateError } = await supabase
      .from('appointments')
      .update({
        professional_id: professionalId || null,
        start_time: toLocalISO(date, startTime),
        end_time:   toLocalISO(date, endTime),
        procedure:  procedure || null,
        notes:      notes || null,
        status,
      })
      .eq('id', apt.id)

    if (updateError) {
      setError('Erro ao salvar alterações.')
      setLoading(false)
      return
    }

    onSaved()
    onClose()
  }

  async function handleDelete() {
    setLoading(true)
    const supabase = createClient()
    await supabase.from('appointments').delete().eq('id', apt.id)
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">

        {activePicker && (
          <ClockPicker
            value={activePicker === 'start' ? startTime : endTime}
            onChange={(v) => { activePicker === 'start' ? setStartTime(v) : setEndTime(v) }}
            onClose={() => setActivePicker(null)}
          />
        )}
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#E5E7EB]">
          <div>
            <h2 className="text-base font-semibold text-[#111827]">Editar consulta</h2>
            <p className="text-xs text-[#6B7280] mt-0.5">{apt.patient?.name || 'Paciente'}</p>
          </div>
          <div className="flex items-center gap-2">
            {status === 'confirmed' ? (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#DBEAFE] text-[#1D4ED8] text-xs font-semibold">
                ✓ Confirmado
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setStatus('confirmed')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3B82F6] text-white text-xs font-semibold hover:bg-[#2563EB] transition-colors"
              >
                ✓ Confirmar
              </button>
            )}
            <button onClick={onClose} className="p-1 rounded text-[#6B7280] hover:text-[#111827]">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Profissional */}
          <div>
            <label className="block text-sm font-medium text-[#111827] mb-1">Profissional</label>
            <select
              value={professionalId}
              onChange={(e) => setProfessionalId(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] bg-white"
            >
              {professionals.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Data e horários */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-[#111827] mb-1">Data</label>
              <input
                type="date" value={date} onChange={(e) => setDate(e.target.value)} required
                className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#111827] mb-1">Início</label>
              <button
                type="button"
                onClick={() => setActivePicker('start')}
                className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm text-left bg-white text-[#111827] hover:border-[#3B82F6] focus:outline-none focus:ring-2 focus:ring-[#3B82F6] transition-colors"
              >
                {startTime}
              </button>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#111827] mb-1">Fim</label>
              <button
                type="button"
                onClick={() => setActivePicker('end')}
                className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm text-left bg-white text-[#111827] hover:border-[#3B82F6] focus:outline-none focus:ring-2 focus:ring-[#3B82F6] transition-colors"
              >
                {endTime}
              </button>
            </div>
          </div>

          {/* Procedimento */}
          <div>
            <label className="block text-sm font-medium text-[#111827] mb-1">Procedimento</label>
            <input
              type="text" value={procedure} onChange={(e) => setProcedure(e.target.value)}
              placeholder="Ex: Limpeza, Canal, Restauração..."
              className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
            />
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-[#111827] mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as AppointmentStatus)}
              className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] bg-white"
            >
              {statusOptions.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          {/* Observações */}
          <div>
            <label className="block text-sm font-medium text-[#111827] mb-1">Observações</label>
            <textarea
              value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Informações adicionais..."
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] resize-none"
            />
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>
          )}

          {/* Botões */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-10 rounded-lg border border-[#E5E7EB] text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 h-10 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-[#2563EB] transition-colors disabled:opacity-50"
            >
              {loading ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </div>

          {/* Excluir */}
          <div className="border-t border-[#F3F4F6] pt-3">
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-2 text-xs text-[#EF4444] hover:underline"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Excluir consulta
              </button>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-xs text-[#374151]">Confirmar exclusão?</span>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={loading}
                  className="text-xs font-semibold text-[#EF4444] hover:underline"
                >
                  Sim, excluir
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs text-[#6B7280] hover:underline"
                >
                  Não
                </button>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
