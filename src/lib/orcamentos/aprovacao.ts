import type { LostReason } from '@/types'
import { toCents, fromCents } from '@/lib/payments/money'
import { todayYmd } from '@/lib/messaging/time'
import { buildSnapshot, hashSnapshot, type Snapshot } from './assinatura'

export const BUDGET_TZ = 'America/Sao_Paulo'
const ALREADY_DECIDED = 'Este orçamento já foi respondido.'
const NOT_FOUND = 'Orçamento não encontrado'

export type Result = { ok: true } | { ok: false; status: number; error: string }
type RpcResult = 'ok' | 'already_decided' | 'not_found'

export interface ApprovalContext {
  budget: { id: string; created_at: string; valid_until: string | null }
  clinicName: string
  patientName: string
  professionalName: string | null
  items: { id: string; procedure: string; tooth: string | null; quantity: number; unit_price: number }[]
}

export interface SignaturePayload {
  provider: 'app' | 'reception'
  provider_ref: string | null
  signer_name: string
  signer_cpf: string
  snapshot: Snapshot
  document_hash: string
  ip: string | null
  user_agent: string | null
  signed_at: string
  approved_by: string | null
}

export interface ApprovalDeps {
  /** Carrega orçamento (da clínica) com itens e nomes para o snapshot; null se não existir. */
  loadForApproval(budgetId: string, clinicId: string): Promise<ApprovalContext | null>
  /** Nome do profissional (usuário) que aprova pela recepção. */
  actorName(clinicId: string, actorId: string): Promise<string | null>
  rpcApprove(
    budgetId: string, linkId: string | null, itemIds: string[], approvedTotal: number,
    signature: SignaturePayload, actorId: string | null,
  ): Promise<RpcResult>
  rpcReject(
    budgetId: string, linkId: string | null, reason: LostReason | null, note: string | null,
    actorId: string | null, status: 'rejected' | 'expired',
  ): Promise<RpcResult>
  /** Orçamentos enviados (a função filtra vencidos). */
  listSent(): Promise<{ id: string; status: string; valid_until: string | null }[]>
}

const fail = (status: number, error: string): Result => ({ ok: false, status, error })

function mapRpc(r: RpcResult): Result {
  if (r === 'ok') return { ok: true }
  return r === 'already_decided' ? fail(409, ALREADY_DECIDED) : fail(404, NOT_FOUND)
}

export async function approveBudget(
  input: {
    budgetId: string; clinicId: string; linkId: string | null; itemIds: string[]
    signer: { name: string; cpf: string } | null
    actorId: string | null; ip: string | null; userAgent: string | null; now: Date
  },
  deps: ApprovalDeps,
): Promise<Result> {
  const ids = [...new Set(input.itemIds)]
  if (ids.length === 0) return fail(422, 'Selecione ao menos um item')

  const ctx = await deps.loadForApproval(input.budgetId, input.clinicId)
  if (!ctx) return fail(404, NOT_FOUND)
  const known = new Set(ctx.items.map((i) => i.id))
  if (ids.some((id) => !known.has(id))) return fail(422, 'Item inválido para este orçamento')

  let signer = input.signer
  let provider: SignaturePayload['provider'] = 'app'
  if (!signer) {
    provider = 'reception'
    const name = input.actorId ? await deps.actorName(input.clinicId, input.actorId) : null
    signer = { name: name ?? '', cpf: '' }
  }

  const snapshot = buildSnapshot({
    clinicName: ctx.clinicName,
    patientName: ctx.patientName,
    professionalName: ctx.professionalName,
    budget: ctx.budget,
    items: ctx.items,
    approvedIds: ids,
    signer,
    signedAt: input.now,
  })
  const approvedCents = ctx.items
    .filter((i) => ids.includes(i.id))
    .reduce((sum, i) => sum + toCents(i.unit_price) * i.quantity, 0)

  const signature: SignaturePayload = {
    provider,
    provider_ref: null,
    signer_name: signer.name,
    signer_cpf: signer.cpf,
    snapshot,
    document_hash: hashSnapshot(snapshot),
    ip: input.ip,
    user_agent: input.userAgent,
    signed_at: input.now.toISOString(),
    approved_by: provider === 'reception' ? input.actorId : null,
  }
  return mapRpc(await deps.rpcApprove(input.budgetId, input.linkId, ids, fromCents(approvedCents), signature, input.actorId))
}

export async function rejectBudget(
  input: {
    budgetId: string; clinicId: string; linkId: string | null; reason: LostReason | null
    note: string | null; actorId: string | null; status: 'rejected' | 'expired'
  },
  deps: ApprovalDeps,
): Promise<Result> {
  if (input.linkId === null && input.status === 'rejected' && !input.reason) return fail(422, 'Escolha o motivo')
  return mapRpc(await deps.rpcReject(input.budgetId, input.linkId, input.reason, input.note, input.actorId, input.status))
}

/** Rotina: vence os orçamentos enviados cuja validade já passou. Devolve quantos venceram. */
export async function expireBudgets(now: Date, deps: ApprovalDeps): Promise<number> {
  const today = todayYmd(now, BUDGET_TZ)
  let n = 0
  for (const b of await deps.listSent()) {
    if (b.status !== 'sent' || !b.valid_until || b.valid_until >= today) continue
    const r = await deps.rpcReject(b.id, null, 'sem_resposta', null, null, 'expired')
    if (r === 'ok') n++
  }
  return n
}
