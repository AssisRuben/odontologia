import type { BudgetStatus } from '@/types'
import type { PatientRow } from '@/lib/messaging/types'
import type { ManualResult } from '@/lib/messaging/manual'
import { DEFAULT_TEMPLATES, buildContext, renderTemplate } from '@/lib/messaging/templates'
import { canSend } from './etapas'
import { newToken, linkUrl } from './links'

export interface MessageContext {
  patient: PatientRow
  clinicName: string
  tz: string
  /** Modelo 'budget' da clínica (message_settings); null = padrão. */
  template: string | null
  total: number
  valid_until: string | null
}

export interface SendDeps {
  loadBudget(budgetId: string, clinicId: string): Promise<
    { id: string; patient_id: string; status: BudgetStatus; total: number; itemCount: number } | null
  >
  getValidityDays(clinicId: string): Promise<number>
  getActiveLink(budgetId: string, clinicId: string): Promise<{ id: string; token: string } | null>
  rpcSend(budgetId: string, token: string, validityDays: number, actorId: string | null): Promise<'ok' | 'not_found' | 'not_sendable'>
  insertResent(budgetId: string, clinicId: string, actorId: string | null): Promise<void>
  /** Lido depois do envio: valid_until já preenchido pelo banco. */
  loadMessageContext(clinicId: string, budgetId: string, patientId: string): Promise<MessageContext | null>
  sendMessage(input: {
    clinicId: string; patient_id: string; body: string; kind: 'budget'; budgetId: string
  }): Promise<ManualResult>
}

export type SendResult = {
  status: number
  body: { link: string; sent: boolean; warning?: string } | { error: string }
}

const fail = (status: number, error: string): SendResult => ({ status, body: { error } })

function warningFor(status: number, error: string): string {
  if (status === 409) return 'WhatsApp desconectado. O link foi criado: copie e envie por outro meio.'
  if (status === 422 && error === 'Paciente sem WhatsApp válido') {
    return 'Paciente sem telefone. Copie o link e envie por outro meio.'
  }
  return error
}

export async function sendBudget(
  input: { budgetId: string; clinicId: string; actorId: string | null; resend: boolean },
  deps: SendDeps,
): Promise<SendResult> {
  const { budgetId, clinicId, actorId } = input
  const budget = await deps.loadBudget(budgetId, clinicId)
  if (!budget) return fail(404, 'Orçamento não encontrado')
  const can = canSend(budget)
  if (!can.ok) return fail(422, can.error)

  let token: string
  const active = input.resend && budget.status === 'sent' ? await deps.getActiveLink(budgetId, clinicId) : null
  if (active) {
    token = active.token
    await deps.insertResent(budgetId, clinicId, actorId)
  } else {
    token = newToken()
    const days = await deps.getValidityDays(clinicId)
    const r = await deps.rpcSend(budgetId, token, days, actorId)
    if (r === 'not_found') return fail(404, 'Orçamento não encontrado')
    if (r === 'not_sendable') return fail(422, 'Este orçamento não pode mais ser enviado')
  }
  const link = linkUrl(token)

  const ctx = await deps.loadMessageContext(clinicId, budgetId, budget.patient_id)
  if (!ctx) return { status: 200, body: { link, sent: false, warning: 'Paciente não encontrado' } }
  const body = renderTemplate(
    ctx.template || DEFAULT_TEMPLATES.budget,
    buildContext({
      patient: ctx.patient,
      clinicName: ctx.clinicName,
      tz: ctx.tz,
      budget: { total: ctx.total, valid_until: ctx.valid_until },
      link,
    }),
  )
  const res = await deps.sendMessage({ clinicId, patient_id: budget.patient_id, body, kind: 'budget', budgetId })
  if (res.status === 200) return { status: 200, body: { link, sent: true } }
  const error = 'error' in res.body ? res.body.error : 'Falha ao enviar pelo WhatsApp'
  return { status: 200, body: { link, sent: false, warning: warningFor(res.status, error) } }
}
