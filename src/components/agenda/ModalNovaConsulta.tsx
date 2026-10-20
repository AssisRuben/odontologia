'use client'

import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { X, CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ClockPicker } from './ClockPicker'
import type { Patient, Professional, InsurancePlan } from '@/types'

// Builds an ISO string with the browser's local timezone offset
// e.g. "2026-06-02T13:00:00-03:00" for UTC-3 browsers
function toLocalISO(date: string, time: string): string {
  const off    = new Date().getTimezoneOffset()          // e.g. 180 for UTC-3
  const sign   = off <= 0 ? '+' : '-'
  const hh     = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')
  const mm     = String(Math.abs(off) % 60).padStart(2, '0')
  return `${date}T${time}:00${sign}${hh}:${mm}`
}

interface ModalNovaConsultaProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  initialDate?: Date
  initialHour?: string
  initialProfessionalId?: string
  clinicId: string
  professionals: Professional[]
  patients: Patient[]
  insurancePlans: InsurancePlan[]
}

const statusOptions = [
  { value: 'scheduled', label: 'Agendado' },
  { value: 'confirmed', label: 'Confirmado' },
  { value: 'waiting', label: 'Aguardando' },
]

function calcEndTime(start: string): string {
  const [h, m] = start.split(':').map(Number)
  const total = h * 60 + m + 30
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export function ModalNovaConsulta({
  open,
  onClose,
  onSaved,
  initialDate,
  initialHour,
  initialProfessionalId,
  clinicId,
  professionals,
  patients,
  insurancePlans,
}: ModalNovaConsultaProps) {
  const [patientSearch, setPatientSearch] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [showPatientList, setShowPatientList] = useState(false)
  const [professionalId, setProfessionalId] = useState(professionals[0]?.id || '')
  const [date, setDate] = useState(initialDate ? format(initialDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'))
  const [startTime, setStartTime] = useState(initialHour || '09:00')
  const [endTime, setEndTime] = useState(calcEndTime(initialHour || '09:00'))
  const [procedure, setProcedure] = useState('')
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState('scheduled')
  const [insurancePlanId, setInsurancePlanId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [activePicker, setActivePicker] = useState<'start' | 'end' | null>(null)

  // Reseta o formulário sempre que o modal abre
  useEffect(() => {
    if (open) {
      const start = initialHour || '09:00'
      setPatientSearch('')
      setSelectedPatient(null)
      setShowPatientList(false)
      setProfessionalId(initialProfessionalId || professionals[0]?.id || '')
      setDate(initialDate ? format(initialDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'))
      setStartTime(start)
      setEndTime(calcEndTime(start))
      setProcedure('')
      setNotes('')
      setStatus('scheduled')
      setInsurancePlanId('')
      setLoading(false)
      setError('')
      setSuccess(false)
      setActivePicker(null)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const filteredPatients = patients.filter((p) =>
    p.name.toLowerCase().includes(patientSearch.toLowerCase())
  )

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!selectedPatient) {
      setError('Selecione um paciente.')
      return
    }
    if (!professionalId) {
      setError('Selecione um profissional.')
      return
    }
    if (!clinicId) {
      setError('Clínica não identificada. Recarregue a página.')
      return
    }

    setError('')
    setLoading(true)

    const supabase = createClient()

    // Atualiza plano do paciente se foi alterado
    const planChanged = insurancePlanId !== (selectedPatient.insurance_plan_id || '')
    if (planChanged) {
      await supabase
        .from('patients')
        .update({ insurance_plan_id: insurancePlanId || null })
        .eq('id', selectedPatient.id)
    }

    const payload = {
      clinic_id: clinicId,
      patient_id: selectedPatient.id,
      professional_id: professionalId,
      start_time: toLocalISO(date, startTime),
      end_time:   toLocalISO(date, endTime),
      status,
      procedure: procedure || null,
      notes: notes || null,
    }

    const { error: insertError } = await supabase.from('appointments').insert(payload)

    if (insertError) {
      setError(`Erro ao salvar: ${insertError.message}`)
      setLoading(false)
      return
    }
    setSuccess(true)
    setLoading(false)
    onSaved()
    setTimeout(onClose, 1500)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={!success ? onClose : undefined} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">

        {/* Overlay de sucesso */}
        {success && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white rounded-xl gap-3">
            <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center">
              <CheckCircle2 className="w-9 h-9 text-green-500" />
            </div>
            <p className="text-base font-semibold text-[#111827]">Consulta agendada!</p>
            <p className="text-sm text-[#6B7280]">
              {selectedPatient?.name} — {date.split('-').reverse().join('/')} às {startTime}
            </p>
          </div>
        )}

        <div className="flex items-center justify-between p-5 border-b border-[#E5E7EB]">
          <h2 className="text-lg font-semibold text-[#111827]">Nova consulta</h2>
          <button onClick={onClose} className="p-1 rounded text-[#6B7280] hover:text-[#111827]">
            <X className="w-5 h-5" />
          </button>
        </div>

        {activePicker && (
          <ClockPicker
            value={activePicker === 'start' ? startTime : endTime}
            onChange={(v) => {
              if (activePicker === 'start') {
                setStartTime(v)
                setEndTime(calcEndTime(v))
              } else {
                setEndTime(v)
              }
            }}
            onClose={() => setActivePicker(null)}
          />
        )}

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Paciente */}
          <div className="relative">
            <label className="block text-sm font-medium text-[#111827] mb-1">Paciente *</label>
            <input
              type="text"
              value={selectedPatient ? selectedPatient.name : patientSearch}
              onChange={(e) => {
                setPatientSearch(e.target.value)
                setSelectedPatient(null)
                setShowPatientList(true)
              }}
              onFocus={() => setShowPatientList(true)}
              placeholder="Buscar paciente..."
              className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
            />
            {showPatientList && !selectedPatient && filteredPatients.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-[#E5E7EB] rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {filteredPatients.slice(0, 8).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setSelectedPatient(p)
                      setInsurancePlanId(p.insurance_plan_id || '')
                      setPatientSearch('')
                      setShowPatientList(false)
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[#F3F4F6] text-[#111827]"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>

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

          {/* Convênio */}
          <div>
            <label className="block text-sm font-medium text-[#111827] mb-1">Convênio</label>
            <select
              value={insurancePlanId}
              onChange={(e) => setInsurancePlanId(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] bg-white"
            >
              <option value="">Particular</option>
              {insurancePlans.map((plan) => (
                <option key={plan.id} value={plan.id}>{plan.name}</option>
              ))}
            </select>
          </div>

          {/* Data e horários */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-[#111827] mb-1">Data</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
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
              type="text"
              value={procedure}
              onChange={(e) => setProcedure(e.target.value)}
              placeholder="Ex: Limpeza, Extração, Canal..."
              className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
            />
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-[#111827] mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
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
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Informações adicionais..."
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] resize-none"
            />
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
              ⚠️ {error}
            </div>
          )}

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
              {loading ? 'Salvando...' : 'Salvar consulta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
