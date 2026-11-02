import type { MessageType, TemplateContext, PatientRow, AppointmentRow, PaymentRow } from './types'
import { formatDataCurta, formatHora, formatDataLonga, formatValor } from './time'

export const TEMPLATE_VARIABLES: (keyof TemplateContext)[] = [
  'paciente', 'paciente_completo', 'data', 'hora', 'profissional', 'clinica', 'valor', 'vencimento',
]

export const DEFAULT_TEMPLATES: Record<MessageType, string> = {
  confirmation: 'Olá, {paciente}! Sua consulta na {clinica} está marcada para {data} às {hora} com {profissional}.\n\nResponda *1* para confirmar ou *2* para desmarcar.',
  reminder: 'Olá, {paciente}! Lembrete: sua consulta na {clinica} é hoje às {hora}. Até logo!',
  recall: 'Olá, {paciente}! Já faz um tempo desde sua última visita à {clinica}. Que tal agendar sua revisão? É só responder esta mensagem.',
  birthday: 'Feliz aniversário, {paciente}! 🎉 A equipe da {clinica} deseja um dia muito especial para você.',
  charge: 'Olá, {paciente}. Identificamos um pagamento de {valor} com vencimento em {vencimento} ainda em aberto na {clinica}. Se já pagou, desconsidere esta mensagem.',
}

const VAR_RE = /\{(\w+)\}/g

export function renderTemplate(t: string, ctx: TemplateContext): string {
  return t.replace(VAR_RE, (match, key: string) =>
    (TEMPLATE_VARIABLES as string[]).includes(key) ? (ctx[key as keyof TemplateContext] ?? '') : match,
  )
}

export function findUnknownVariables(t: string): string[] {
  const found: string[] = []
  for (const m of t.matchAll(VAR_RE)) {
    if (!(TEMPLATE_VARIABLES as string[]).includes(m[1]) && !found.includes(m[1])) found.push(m[1])
  }
  return found
}

export function buildContext(args: {
  patient: PatientRow
  clinicName: string
  tz: string
  appointment?: AppointmentRow
  payment?: PaymentRow
}): TemplateContext {
  const { patient, clinicName, tz, appointment, payment } = args
  const ctx: TemplateContext = {
    paciente: patient.name.trim().split(/\s+/)[0] ?? '',
    paciente_completo: patient.name.trim(),
    clinica: clinicName,
  }
  if (appointment) {
    const start = new Date(appointment.start_time)
    ctx.data = formatDataCurta(start, tz)
    ctx.hora = formatHora(start, tz)
    if (appointment.professional_name) ctx.profissional = appointment.professional_name
  }
  if (payment) {
    ctx.valor = formatValor(payment.amount)
    if (payment.due_date) ctx.vencimento = formatDataLonga(payment.due_date)
  }
  return ctx
}
