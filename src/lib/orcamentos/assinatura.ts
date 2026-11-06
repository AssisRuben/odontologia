import { createHash } from 'node:crypto'
import { normalizeCpf } from '@/lib/payments/cpf'
import { toCents } from '@/lib/payments/money'

export type Snapshot = {
  clinica: string
  paciente: string
  dentista: string | null
  orcamento: string
  data: string
  validade: string | null
  itens_aprovados: {
    procedimento: string
    dente: string | null
    quantidade: number
    preco_unitario: string
    subtotal: string
  }[]
  itens_nao_aprovados: { procedimento: string }[]
  total_aprovado: string
  assinante: { nome: string; cpf: string }
  assinado_em: string
}

function centsText(c: number): string {
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`
}

export function buildSnapshot(args: {
  clinicName: string
  patientName: string
  professionalName: string | null
  budget: { id: string; created_at: string; valid_until: string | null }
  items: { id: string; procedure: string; tooth: string | null; quantity: number; unit_price: number }[]
  approvedIds: string[]
  signer: { name: string; cpf: string }
  signedAt: Date
}): Snapshot {
  const approved = new Set(args.approvedIds)
  let total = 0
  const itens_aprovados = args.items
    .filter((i) => approved.has(i.id))
    .map((i) => {
      const unit = toCents(i.unit_price)
      const sub = unit * i.quantity
      total += sub
      return {
        procedimento: i.procedure,
        dente: i.tooth ? i.tooth : null,
        quantidade: i.quantity,
        preco_unitario: centsText(unit),
        subtotal: centsText(sub),
      }
    })
  return {
    clinica: args.clinicName,
    paciente: args.patientName,
    dentista: args.professionalName,
    orcamento: args.budget.id.slice(0, 8).toUpperCase(),
    data: args.budget.created_at,
    validade: args.budget.valid_until,
    itens_aprovados,
    itens_nao_aprovados: args.items.filter((i) => !approved.has(i.id)).map((i) => ({ procedimento: i.procedure })),
    total_aprovado: centsText(total),
    assinante: { nome: args.signer.name, cpf: args.signer.cpf },
    assinado_em: args.signedAt.toISOString(),
  }
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])]))
  }
  return v
}

export function canonicalJson(v: unknown): string {
  return JSON.stringify(sortKeys(v))
}

export function hashSnapshot(s: Snapshot): string {
  return createHash('sha256').update(canonicalJson(s)).digest('hex')
}

export function checkSignerCpf(
  typed: string,
  patientCpf: string | null,
  payerCpf: string | null,
): { ok: true; cpf: string } | { ok: false; error: 'CPF inválido' | 'O CPF não confere com o cadastro. Confira ou fale com a clínica.' } {
  const cpf = normalizeCpf(typed)
  if (!cpf) return { ok: false, error: 'CPF inválido' }
  const registered = [patientCpf, payerCpf]
    .map((c) => (c ? normalizeCpf(c) : null))
    .filter((c): c is string => c !== null)
  if (registered.length > 0 && !registered.includes(cpf)) {
    return { ok: false, error: 'O CPF não confere com o cadastro. Confira ou fale com a clínica.' }
  }
  return { ok: true, cpf }
}

export interface SignatureProvider {
  id: 'app'
  sign(input: unknown): Promise<{ providerRef: string | null }>
}

export const appSignatureProvider: SignatureProvider = {
  id: 'app',
  async sign() {
    return { providerRef: null }
  },
}
