export type MessageType = 'confirmation' | 'reminder' | 'recall' | 'birthday' | 'charge' | 'payment_due'
export type MessageKind = MessageType | 'manual' | 'auto_reply' | 'incoming'
export type MessageStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled' | 'received'

export interface MessagingConfig {
  window_start: string
  window_end: string
  daily_limit: number
  timezone: string
}

export interface MessageSetting {
  type: MessageType
  enabled: boolean
  template: string
  config: { offset_hours?: number; offset_months?: number; offset_days?: number[] }
}

export interface PatientRow {
  id: string
  name: string
  phone: string | null
  whatsapp: string | null
  birthdate: string | null
  whatsapp_opt_out: boolean
}

export interface AppointmentRow {
  id: string
  patient_id: string
  professional_name: string | null
  start_time: string
  status: string
}

export interface PaymentRow {
  id: string
  patient_id: string
  amount: number
  due_date: string | null
  status: string
}

export interface QueueItem {
  clinic_id: string
  patient_id: string
  appointment_id: string | null
  payment_id: string | null
  type: MessageType
  phone: string
  body: string
  scheduled_for: Date
  expires_at: Date | null
  dedupe_key: string
}

export interface TemplateContext {
  paciente?: string
  paciente_completo?: string
  data?: string
  hora?: string
  profissional?: string
  clinica?: string
  valor?: string
  vencimento?: string
  link?: string
}
