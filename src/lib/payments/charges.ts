import { randomUUID } from 'node:crypto'
import { normalizeCpf } from './cpf'
import { splitInstallments, validateChargeInput } from './installments'
import { toApiError } from './connection'
import type { ChargeKind, PaymentProvider, ProviderCharge } from './provider'
import type { ManualResult } from '@/lib/messaging/manual'

export interface CreateChargeInput {
  clinicId: string
  patientId: string
  budgetId?: string | null
  amountCents: number
  description: string
  kind: ChargeKind
  installmentCount: number
  firstDueDate: string
  cpf?: string | null
  sendWhatsApp: boolean
}

export interface ChargePatient {
  id: string
  name: string
  cpf: string | null
  phone: string | null
  whatsapp: string | null
  email: string | null
}

export interface CreatingRow {
  clinicId: string
  patientId: string
  budgetId: string | null
  groupId: string
  kind: ChargeKind
  installmentNumber: number | null
  installmentCount: number | null
  amountCents: number
  dueDate: string
  description: string
  paymentMethod: 'boleto' | 'cartao_credito' | null
}

export interface ChargeDeps {
  getPatient(clinicId: string, patientId: string): Promise<ChargePatient | null>
  budgetBelongsToPatient(clinicId: string, patientId: string, budgetId: string): Promise<boolean>
  savePatientCpf(clinicId: string, patientId: string, cpf: string): Promise<void>
  getConnection(clinicId: string): Promise<{
    provider: PaymentProvider
    connection: { status: 'connected' | 'invalid_key'; fine_percent: number; interest_percent_month: number }
  } | null>
  getCustomerId(clinicId: string, patientId: string): Promise<string | null>
  saveCustomerId(clinicId: string, patientId: string, customerId: string): Promise<void>
  findRecentDuplicate(
    clinicId: string, patientId: string, amountCents: number, description: string, since: Date,
  ): Promise<boolean>
  /** Insere as linhas 'creating' e devolve os ids, na ordem das parcelas. */
  insertCreatingRows(rows: CreatingRow[]): Promise<string[]>
  linkRows(clinicId: string, groupId: string, charges: ProviderCharge[]): Promise<void>
  deleteRows(clinicId: string, groupId: string): Promise<void>
  markInvalidKey(clinicId: string): Promise<void>
  sendLink(clinicId: string, paymentId: string): Promise<ManualResult>
  today(clinicId: string, now: Date): Promise<string>
}

export type CreateChargeResult =
  | { status: 201; body: { groupId: string; paymentIds: string[]; pending?: true; whatsapp?: { ok: boolean; error?: string } } }
  | { status: number; body: { error: string } }

const UNAVAILABLE_MSG = 'Não foi possível gerar a cobrança agora. Nada foi cobrado do paciente. Tente novamente.'
const DUPLICATE_WINDOW_MS = 30_000
const KINDS: ChargeKind[] = ['avulsa', 'carne', 'cartao_parcelado']
const fail = (status: number, error: string) => ({ status, body: { error } })

function isRealDate(ymd: unknown): ymd is string {
  if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

export async function createCharge(input: CreateChargeInput, deps: ChargeDeps, now: Date): Promise<CreateChargeResult> {
  const { clinicId, patientId } = input
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  if (!description) return fail(422, 'Informe a descrição')
  if (!KINDS.includes(input.kind)) return fail(422, 'Tipo de cobrança inválido')
  if (!isRealDate(input.firstDueDate)) return fail(422, 'Data de vencimento inválida')
  const count = input.kind === 'avulsa' ? 1 : input.installmentCount

  const invalid = validateChargeInput({
    amountCents: input.amountCents,
    installmentCount: count,
    firstDueDate: input.firstDueDate,
    today: await deps.today(clinicId, now),
  })
  if (invalid) return fail(422, invalid)

  const patient = await deps.getPatient(clinicId, patientId)
  if (!patient) return fail(404, 'Paciente não encontrado')
  if (input.budgetId && !(await deps.budgetBelongsToPatient(clinicId, patientId, input.budgetId))) {
    return fail(404, 'Paciente não encontrado')
  }

  const given = input.cpf?.trim() ? input.cpf : null
  let cpf: string
  if (given) {
    const n = normalizeCpf(given)
    if (!n) return fail(422, 'CPF inválido')
    cpf = n
  } else if (patient.cpf) {
    const n = normalizeCpf(patient.cpf)
    if (!n) return fail(422, 'CPF inválido')
    cpf = n
  } else {
    return fail(422, 'Informe o CPF do paciente')
  }

  const conn = await deps.getConnection(clinicId)
  if (!conn) return fail(409, 'Conecte o Asaas em Configurações → Pagamentos')
  if (conn.connection.status !== 'connected') return fail(409, 'asaas_invalid_key')

  const since = new Date(now.getTime() - DUPLICATE_WINDOW_MS)
  if (await deps.findRecentDuplicate(clinicId, patientId, input.amountCents, description, since)) {
    return fail(409, 'Cobrança igual criada há instantes')
  }

  // O CPF informado só é gravado na ficha depois de passar por todas as validações.
  if (given && normalizeCpf(patient.cpf ?? '') !== cpf) await deps.savePatientCpf(clinicId, patientId, cpf)

  const groupId = randomUUID()
  const installments = splitInstallments(input.amountCents, count, input.firstDueDate)
  const single = input.kind === 'avulsa'
  const rows: CreatingRow[] = installments.map((i) => ({
    clinicId,
    patientId,
    budgetId: input.budgetId ?? null,
    groupId,
    kind: input.kind,
    installmentNumber: single ? null : i.number,
    installmentCount: single ? null : count,
    amountCents: i.amountCents,
    dueDate: i.dueDate,
    description,
    paymentMethod: input.kind === 'carne' ? 'boleto' : input.kind === 'cartao_parcelado' ? 'cartao_credito' : null,
  }))
  const paymentIds = await deps.insertCreatingRows(rows)

  let charges: ProviderCharge[]
  // Depois que createCharge é chamado, o Asaas pode ter criado as cobranças mesmo com erro de rede.
  let creating = false
  try {
    let customerId = await deps.getCustomerId(clinicId, patientId)
    if (!customerId) {
      customerId = await conn.provider.ensureCustomer({
        externalId: patientId,
        name: patient.name,
        cpf,
        phone: patient.whatsapp ?? patient.phone ?? undefined,
        email: patient.email ?? undefined,
      })
      try {
        await deps.saveCustomerId(clinicId, patientId, customerId)
      } catch (e) {
        // Só cache: ensureCustomer é idempotente, então a próxima cobrança refaz.
        console.error('[payments/charges] falha ao guardar o cliente:', (e as Error).message)
      }
    }
    creating = true
    charges = await conn.provider.createCharge({
      customerId,
      externalReference: groupId,
      description,
      kind: input.kind,
      totalCents: input.amountCents,
      installmentCount: count,
      firstDueDate: input.firstDueDate,
      finePercent: conn.connection.fine_percent,
      interestPercentMonth: conn.connection.interest_percent_month,
    })
  } catch (e) {
    const err = toApiError(e)
    if (creating && err.status === 503) {
      // Incerto se o Asaas criou: as linhas ficam 'creating' e a conferência completa ou apaga.
      console.error('[payments/charges] Asaas sem resposta ao criar; aguardando conferência:', (e as Error).message)
      return { status: 201, body: { groupId, paymentIds, pending: true } }
    }
    if (err.status === 503) err.error = UNAVAILABLE_MSG
    if (err.status === 409) await deps.markInvalidKey(clinicId).catch(() => {})
    else if (err.status === 500) console.error('[payments/charges] falha ao criar no Asaas:', (e as Error).message)
    await deps.deleteRows(clinicId, groupId).catch((d) => console.error('[payments/charges] falha ao apagar linhas:', (d as Error).message))
    return fail(err.status, err.error)
  }

  try {
    await deps.linkRows(clinicId, groupId, charges)
  } catch (e) {
    // O Asaas já criou: as linhas ficam 'creating' e a conferência completa depois.
    console.error('[payments/charges] falha ao associar cobranças:', (e as Error).message)
    return { status: 201, body: { groupId, paymentIds, pending: true } }
  }

  const body: { groupId: string; paymentIds: string[]; whatsapp?: { ok: boolean; error?: string } } = { groupId, paymentIds }
  if (input.sendWhatsApp) {
    try {
      const r = await deps.sendLink(clinicId, paymentIds[0])
      body.whatsapp = r.status === 200 ? { ok: true } : { ok: false, error: 'error' in r.body ? r.body.error : 'Falha ao enviar' }
    } catch (e) {
      console.error('[payments/charges] falha no WhatsApp:', (e as Error).message)
      body.whatsapp = { ok: false, error: 'Falha ao enviar' }
    }
  }
  return { status: 201, body }
}
