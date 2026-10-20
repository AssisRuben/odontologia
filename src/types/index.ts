export interface Clinic {
  id: string
  name: string
  cnpj?: string
  phone?: string
  address?: string
  card_rates?: Record<string, string>
  whatsapp_key?: string
  whatsapp_phone?: string
  created_at: string
}

export interface AnamnesisQuestion {
  id: string
  text: string
  type: 'text' | 'yesno' | 'options'
  options?: string[]
}

export interface AnamnesisTemplate {
  id: string
  clinic_id: string
  name: string
  questions: AnamnesisQuestion[]
  created_at: string
}

export interface Professional {
  id: string
  clinic_id: string
  user_id?: string
  name: string
  cro?: string
  specialty?: string
  color: string
  working_hours?: Record<string, unknown>
  created_at: string
}

export interface InsurancePlan {
  id: string
  clinic_id: string
  name: string
  created_at: string
}

export interface Patient {
  id: string
  clinic_id: string
  name: string
  cpf?: string
  phone?: string
  whatsapp?: string
  email?: string
  birthdate?: string
  gender?: string
  address?: {
    street?: string
    number?: string
    complement?: string
    neighborhood?: string
    city?: string
    state?: string
    zip?: string
  }
  insurance_plan_id?: string
  insurance_plan?: InsurancePlan
  notes?: string
  created_at: string
}

// Helpers para persistir tags no campo notes como JSON
export function parsePatientNotes(raw?: string): { tags: string[]; notes: string } {
  if (!raw) return { tags: [], notes: '' }
  try {
    const obj = JSON.parse(raw)
    if (obj && typeof obj === 'object' && 'tags' in obj) {
      return { tags: obj.tags ?? [], notes: obj.notes ?? '' }
    }
  } catch {
    // notas em formato texto puro
  }
  return { tags: [], notes: raw }
}

export function serializePatientNotes(tags: string[], notes: string): string {
  if (tags.length === 0) return notes
  return JSON.stringify({ tags, notes })
}

export type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'waiting'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show'

export interface Appointment {
  id: string
  clinic_id: string
  patient_id: string
  professional_id: string
  start_time: string
  end_time: string
  status: AppointmentStatus
  procedure?: string
  notes?: string
  color?: string
  created_at: string
  patient?: Patient
  professional?: Professional
}

export type PaymentMethod =
  | 'dinheiro'
  | 'cartao_credito'
  | 'cartao_debito'
  | 'pix'
  | 'boleto'
  | 'convenio'

export type PaymentStatus = 'pending' | 'paid' | 'overdue'

export interface Payment {
  id: string
  clinic_id: string
  patient_id: string
  appointment_id?: string
  amount: number
  payment_method?: PaymentMethod
  status: PaymentStatus
  due_date?: string
  paid_at?: string
  description?: string
  created_at: string
  patient?: Patient
}

export interface Expense {
  id: string
  clinic_id: string
  description: string
  amount: number
  category?: string
  due_date?: string
  paid_at?: string
  status: 'pending' | 'paid' | 'overdue'
  created_at: string
}

export type ProstheticStatus = 'requested' | 'sent_to_lab' | 'returned' | 'installed'

export interface Prosthetic {
  id: string
  clinic_id: string
  patient_id: string
  professional_id?: string
  laboratory?: string
  type?: string
  status: ProstheticStatus
  requested_at: string
  expected_at?: string
  notes?: string
  patient?: Patient
  professional?: Professional
}

export interface InventoryItem {
  id: string
  clinic_id: string
  name: string
  category?: string
  quantity: number
  min_quantity: number
  unit?: string
  created_at: string
}

export interface InventoryMovement {
  id: string
  item_id: string
  type: 'in' | 'out'
  quantity: number
  reason?: string
  created_at: string
  item?: InventoryItem
}

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  waiting: 'Aguardando',
  in_progress: 'Em atendimento',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  no_show: 'Faltou',
}

export const APPOINTMENT_STATUS_COLORS: Record<AppointmentStatus, string> = {
  scheduled: '#F59E0B',
  confirmed: '#3B82F6',
  waiting: '#8B5CF6',
  in_progress: '#10B981',
  completed: '#6B7280',
  cancelled: '#EF4444',
  no_show: '#EF4444',
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  dinheiro: 'Dinheiro',
  cartao_credito: 'Cartão de Crédito',
  cartao_debito: 'Cartão de Débito',
  pix: 'PIX',
  boleto: 'Boleto',
  convenio: 'Convênio',
}

export type TreatmentStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled'

export interface TreatmentTooth {
  id: string
  treatment_id: string
  tooth_number: number
  faces: string[]
}

export interface Treatment {
  id: string
  clinic_id: string
  patient_id: string
  professional_id?: string
  insurance_plan_id?: string
  procedure: string
  value: number
  date: string
  status: TreatmentStatus
  notes?: string
  created_at: string
  professional?: Professional
  insurance_plan?: InsurancePlan
  treatment_teeth?: TreatmentTooth[]
}
