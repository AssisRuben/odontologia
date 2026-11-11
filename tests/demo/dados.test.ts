import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { montarDados, cpfValido } from '../../scripts/demo/dados.mjs'

type Linha = Record<string, unknown>

const ctx = {
  hoje: '2026-11-11', // quarta-feira
  clinicId: 'clinica-demo',
  donoId: 'dono',
  userId: 'usuario',
  uid: () => randomUUID(),
  tuss: [
    { code: '81000065', name: 'Consulta odontológica inicial' },
    { code: '85100196', name: 'Restauração de resina' },
  ],
  glosa: '1801',
  perguntas: [{ id: 'q1', type: 'yesno' }, { id: 'q2', type: 'text' }],
}

const demo = montarDados(ctx)
const tabela = (nome: string): Linha[] => demo.insercoes.find(([t]: [string]) => t === nome)?.[1] ?? []

function digitosCpf(cpf: string) {
  const d = cpf.replace(/\D/g, '').split('').map(Number)
  const dv = (n: number) => {
    const s = d.slice(0, n).reduce((acc, x, i) => acc + x * (n + 1 - i), 0)
    const r = (s * 10) % 11
    return r === 10 ? 0 : r
  }
  return { d, dv1: dv(9), dv2: dv(10) }
}

describe('cpfValido', () => {
  it('calcula os dígitos verificadores', () => {
    expect(cpfValido('529982247')).toBe('529.982.247-25')
  })
})

describe('montarDados', () => {
  it('todo vínculo aponta para um registro criado antes (ou para o dono)', () => {
    const vistos = new Set<string>([ctx.donoId])
    const fks = ['patient_id', 'professional_id', 'appointment_id', 'insurance_plan_id', 'guide_id', 'item_id',
      'kit_id', 'laboratory_id', 'prosthetic_id', 'conversation_id', 'budget_id', 'treatment_id', 'lot_id',
      'expense_id', 'template_id', 'payment_id']
    for (const [nome, linhas] of demo.insercoes as [string, Linha[]][]) {
      for (const l of linhas) {
        for (const fk of fks) {
          const v = l[fk]
          if (v != null) expect(vistos.has(v as string), `${nome}.${fk}`).toBe(true)
        }
      }
      for (const l of linhas) if (l.id) vistos.add(l.id as string)
    }
  })

  it('grava tudo na clínica demo', () => {
    for (const [nome, linhas] of demo.insercoes as [string, Linha[]][]) {
      for (const l of linhas) if ('clinic_id' in l) expect(l.clinic_id, nome).toBe(ctx.clinicId)
    }
  })

  it('tem consultas de todos os status, de segunda passada a sábado que vem, sem domingo', () => {
    const consultas = tabela('appointments')
    expect(new Set(consultas.map(c => c.status))).toEqual(
      new Set(['scheduled', 'confirmed', 'waiting', 'in_progress', 'completed', 'cancelled', 'no_show']))
    for (const c of consultas) {
      const dia = (c.start_time as string).slice(0, 10)
      expect(dia >= '2026-11-02' && dia <= '2026-11-21', dia).toBe(true)
      expect(new Date(`${dia}T12:00:00Z`).getUTCDay(), dia).not.toBe(0)
    }
  })

  it('tem consultas hoje e um aniversariante hoje', () => {
    expect(tabela('appointments').some(c => (c.start_time as string).startsWith('2026-11-11'))).toBe(true)
    expect(tabela('patients').some(p => (p.birthdate as string)?.slice(5) === '11-11')).toBe(true)
  })

  it('CPFs dos pacientes são válidos', () => {
    for (const p of tabela('patients')) {
      const { d, dv1, dv2 } = digitosCpf(p.cpf as string)
      expect([d[9], d[10]], p.cpf as string).toEqual([dv1, dv2])
    }
  })

  it('itens com validade têm quantidade igual à soma dos lotes, e há um lote vencido', () => {
    const lotes = tabela('inventory_lots')
    for (const item of tabela('inventory_items').filter(i => i.tracks_expiry)) {
      const soma = lotes.filter(l => l.item_id === item.id).reduce((s, l) => s + (l.quantity as number), 0)
      expect(item.quantity, item.name as string).toBe(soma)
    }
    expect(lotes.some(l => l.expires_at && (l.expires_at as string) < ctx.hoje)).toBe(true)
  })

  it('orçamentos cobrem rascunho, enviado, visto, aprovado e perdido', () => {
    expect(new Set(demo.orcamentos.map((o: { acao: string }) => o.acao)))
      .toEqual(new Set(['rascunho', 'enviar', 'ver', 'aprovar', 'perder']))
    for (const o of demo.orcamentos) expect(tabela('budgets').some(b => b.id === o.id && b.status === 'draft')).toBe(true)
  })

  it('próteses em todas as etapas, cada uma com histórico', () => {
    const proteses = tabela('prosthetics')
    expect(new Set(proteses.map(p => p.status))).toEqual(new Set(['requested', 'sent_to_lab', 'returned', 'installed']))
    for (const p of proteses) expect(tabela('prosthetic_events').some(e => e.prosthetic_id === p.id)).toBe(true)
  })

  it('convênios respeitam os limites do banco (fechamento 1–28 ou vazio)', () => {
    for (const p of tabela('insurance_plans')) {
      if (p.closing_day != null) expect(p.closing_day as number).toBeLessThanOrEqual(28)
    }
  })

  it('o lote de convênio paga todos os itens dele, com uma glosa', () => {
    const itens = demo.lote.itens as { id: string; paid_value: number; glosa_code?: string }[]
    expect(itens.map(i => i.id).sort()).toEqual([...demo.lote.itemIds].sort())
    expect(itens.filter(i => i.glosa_code === ctx.glosa)).toHaveLength(1)
  })
})
