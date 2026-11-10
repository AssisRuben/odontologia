'use client'

import { useEffect, useMemo, useState } from 'react'
import { X, Send } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { buildContext, renderTemplate, DEFAULT_TEMPLATES, MANUAL_TEMPLATES } from '@/lib/messaging/templates'
import { MAX_MANUAL_LENGTH } from '@/lib/messaging/manual'
import type { AppointmentRow, MessageType, PaymentRow } from '@/lib/messaging/types'
import type { Appointment, Patient } from '@/types'
import { DEFAULT_TZ, resolveTz } from './helpers'

interface Props {
  patient: Patient
  appointments: Appointment[]
  onClose: () => void
  onSent: () => void
}

// Sem "Confirmação": a resposta 1/2 só vale para confirmações automáticas (R14).
const TEMPLATE_OPTIONS: { value: MessageType; label: string }[] = [
  { value: 'reminder', label: 'Lembrete' },
  { value: 'recall', label: 'Retorno' },
  { value: 'birthday', label: 'Aniversário' },
  { value: 'charge', label: 'Cobrança' },
]

type Choice = 'free' | 'payment_link' | MessageType

export function ModalEnviarWhatsApp({ patient, appointments, onClose, onSent }: Props) {
  const [choice, setChoice] = useState<Choice>('free')
  const [text, setText] = useState('')
  const [templates, setTemplates] = useState<Record<MessageType, string>>(DEFAULT_TEMPLATES)
  const [clinicName, setClinicName] = useState('')
  const [tz, setTz] = useState(DEFAULT_TZ)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  // Cobrança em aberto mais próxima do vencimento que tenha link; null = não há; undefined = carregando.
  const [linkPayment, setLinkPayment] = useState<PaymentRow | null | undefined>(undefined)
  const [openedAt] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    Promise.all([
      supabase.from('message_settings').select('type, template').eq('clinic_id', patient.clinic_id),
      supabase.from('clinics').select('name, messaging_config').eq('id', patient.clinic_id).maybeSingle(),
    ]).then(([s, c]) => {
      if (cancelled) return
      const merged = { ...DEFAULT_TEMPLATES }
      for (const r of (s.data ?? []) as { type: MessageType; template: string }[]) {
        if (r.template && r.type in merged) merged[r.type] = r.template
      }
      setTemplates(merged)
      setClinicName((c.data?.name as string | undefined) ?? '')
      setTz(resolveTz((c.data?.messaging_config as { timezone?: unknown } | null)?.timezone))
    })
    return () => { cancelled = true }
  }, [patient.clinic_id])

  useEffect(() => {
    let cancelled = false
    createClient()
      .from('payments')
      .select('id, patient_id, amount, due_date, status, invoice_url, provider_state')
      .eq('patient_id', patient.id)
      .in('status', ['pending', 'overdue'])
      .not('invoice_url', 'is', null)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(1)
      .then(({ data }) => {
        if (!cancelled) setLinkPayment(((data ?? []) as PaymentRow[])[0] ?? null)
      })
    return () => { cancelled = true }
  }, [patient.id])

  // Próxima consulta futura (agendada/confirmada) do paciente, se houver.
  const nextAppointment = useMemo<AppointmentRow | undefined>(() => {
    const now = openedAt
    const upcoming = appointments
      .filter((a) => (a.status === 'scheduled' || a.status === 'confirmed') && new Date(a.start_time).getTime() > now)
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())[0]
    if (!upcoming) return undefined
    return {
      id: upcoming.id,
      patient_id: upcoming.patient_id,
      professional_name: upcoming.professional?.name ?? null,
      start_time: upcoming.start_time,
      status: upcoming.status,
    }
  }, [appointments, openedAt])

  function pick(value: Choice) {
    setChoice(value)
    setError('')
    if (value === 'free') { setText(''); return }
    const patientRow = {
      id: patient.id,
      name: patient.name,
      phone: patient.phone ?? null,
      whatsapp: patient.whatsapp ?? null,
      birthdate: patient.birthdate ?? null,
      whatsapp_opt_out: !!patient.whatsapp_opt_out,
    }
    if (value === 'payment_link') {
      if (!linkPayment) return
      setText(renderTemplate(MANUAL_TEMPLATES.payment_link, buildContext({ patient: patientRow, clinicName, tz, payment: linkPayment })))
      return
    }
    const ctx = buildContext({
      patient: patientRow,
      clinicName,
      tz,
      appointment: value === 'reminder' ? nextAppointment : undefined,
    })
    setText(renderTemplate(templates[value], ctx))
  }

  async function handleSend() {
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: patient.id, body: text }),
      })
      if (res.ok) { onSent(); onClose(); return }
      const data = await res.json().catch(() => null)
      setError(typeof data?.error === 'string' ? data.error : 'Não foi possível enviar. Tente novamente.')
    } catch {
      setError('Não foi possível enviar. Verifique a conexão e tente novamente.')
    } finally {
      setSending(false)
    }
  }

  const tooLong = text.length > MAX_MANUAL_LENGTH
  const canSend = text.trim().length > 0 && !tooLong && !sending

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={sending ? undefined : onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-linha">
          <h2 className="text-base font-semibold text-tinta">Enviar WhatsApp</h2>
          <button onClick={onClose} className="p-1 rounded text-tinta-4 hover:text-tinta-2" aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-tinta-3">Para: <span className="font-medium text-tinta">{patient.name}</span></p>

          <div>
            <label htmlFor="wa-modelo" className="block text-sm font-medium text-tinta mb-1">Mensagem</label>
            <select
              id="wa-modelo"
              value={choice}
              onChange={(e) => pick(e.target.value as Choice)}
              className="w-full h-10 px-3 rounded-lg border border-linha text-sm focus:outline-none focus:ring-2 focus:ring-petroleo bg-white"
            >
              <option value="free">Texto livre</option>
              {TEMPLATE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              <option value="payment_link" disabled={!linkPayment}>
                {linkPayment === undefined || linkPayment ? 'Link de pagamento' : 'Link de pagamento (sem cobrança em aberto com link)'}
              </option>
            </select>
          </div>

          <div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder="Digite a mensagem"
              className="w-full px-3 py-2 rounded-lg border border-linha text-sm focus:outline-none focus:ring-2 focus:ring-petroleo"
            />
            <p className={`text-xs mt-1 text-right ${tooLong ? 'text-red-600' : 'text-tinta-4'}`}>
              {text.length}/{MAX_MANUAL_LENGTH}
            </p>
          </div>

          {error && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3">
            <button type="button" onClick={onClose} disabled={sending}
              className="flex-1 h-10 rounded-lg border border-linha text-sm font-medium text-tinta-3 hover:bg-porcelana disabled:opacity-50">
              Cancelar
            </button>
            <button type="button" onClick={handleSend} disabled={!canSend}
              className="flex-1 h-10 rounded-lg bg-[#25D366] text-white text-sm font-medium hover:bg-[#1EBE5A] disabled:opacity-50 inline-flex items-center justify-center gap-2">
              <Send className="w-4 h-4" />
              {sending ? 'Enviando...' : 'Enviar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
