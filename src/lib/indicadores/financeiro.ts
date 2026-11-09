import { mesDe } from '@/lib/comissoes/periodo'
import { mesDoInstante } from './periodo'

export type RecebimentoIn = {
  patient_id: string
  amount: number
  payment_method: string | null
  /** YYYY-MM-DD */
  paid_at: string
}

const centavos = (reais: number) => Math.round(reais * 100)

function soma(recs: RecebimentoIn[]) {
  const pacientes = new Set<string>()
  let total = 0
  for (const r of recs) {
    total += centavos(r.amount)
    pacientes.add(r.patient_id)
  }
  return { total, pacientes: pacientes.size }
}

const ticket = (total: number, pacientes: number) => (pacientes > 0 ? Math.round(total / pacientes) : null)

export function resumoFinanceiro(recs: RecebimentoIn[], mes: string) {
  const doMes = recs.filter((r) => mesDe(r.paid_at) === mes)
  const conv = doMes.filter((r) => r.payment_method === 'convenio')
  const part = doMes.filter((r) => r.payment_method !== 'convenio')
  const t = soma(doMes)
  const c = soma(conv)
  const p = soma(part)
  return {
    recebidoCentavos: t.total,
    particularCentavos: p.total,
    convenioCentavos: c.total,
    pacientes: t.pacientes,
    ticketCentavos: ticket(t.total, t.pacientes),
    ticketParticularCentavos: ticket(p.total, p.pacientes),
    ticketConvenioCentavos: ticket(c.total, c.pacientes),
  }
}

export type TratamentoIn = { professional_id: string | null; value: number; completed_at: string }

export function producao(
  trats: TratamentoIn[],
  mes: string,
  professionalId: string | null,
): { totalCentavos: number; porDentista: { professional_id: string | null; totalCentavos: number }[] } {
  const porDentista = new Map<string | null, number>()
  let totalCentavos = 0
  for (const t of trats) {
    if (mesDoInstante(t.completed_at) !== mes) continue
    if (professionalId !== null && t.professional_id !== professionalId) continue
    const v = centavos(t.value)
    totalCentavos += v
    porDentista.set(t.professional_id, (porDentista.get(t.professional_id) ?? 0) + v)
  }
  return {
    totalCentavos,
    porDentista: [...porDentista.entries()].map(([professional_id, total]) => ({
      professional_id,
      totalCentavos: total,
    })),
  }
}

export type PacienteIn = { id: string; name: string; created_at: string; source: string | null }

export function pacientesNovos(pacs: PacienteIn[], mes: string): { total: number; whatsapp: number } {
  const doMes = pacs.filter((p) => mesDoInstante(p.created_at) === mes)
  return { total: doMes.length, whatsapp: doMes.filter((p) => p.source === 'whatsapp').length }
}
