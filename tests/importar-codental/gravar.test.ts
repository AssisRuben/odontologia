import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { gravarPlano } from '../../scripts/importar-codental/gravar.mjs'
import { configConexao, principal } from '../../scripts/importar-codental/cli.mjs'

const CLINICA = '11111111-1111-4111-8111-111111111111'
const PROF = '22222222-2222-4222-8222-222222222222'
const ALVO = '33333333-3333-4333-8333-333333333333'
const ALVO2 = '44444444-4444-4444-8444-444444444444'
const NOME = 'Fulano Sigiloso'
const CPF = '12345678909'
const opts = { clinicId: CLINICA, professionalId: PROF }

type Linha = Record<string, unknown>
type Link = { entity: string; source_id: string; target_id: string }
type ItemPlano = { sourceId: string; procedure: string; tooth: string | null; quantity: number; unit_price: number; approved: boolean | null }
type Config = {
  clinica?: boolean
  profissional?: boolean
  links?: Link[]
  semVinculo?: number
  planos?: { id: string; name: string }[]
  procedimentos?: { id: string; insurance_plan_id: string; code: string }[]
  orcamentosBanco?: { id: string; patient_id: string }[]
  itensBanco?: { id: string; budget_id: string }[]
  falharEm?: RegExp
  comandoCommit?: string
}

const ERRO_PG = () => Object.assign(new Error(`valor duplicado ${NOME}`), {
  code: '23505', constraint: 'patients_pkey', detail: `Key (cpf)=(${CPF})`, where: `linha ${NOME}`,
})

class ClienteFalso {
  chamadas: { sql: string; params: unknown[] }[] = []
  constructor(private cfg: Config = {}) {}

  async query(sql: string, params: unknown[] = []) {
    this.chamadas.push({ sql, params })
    const c = this.cfg
    if (c.falharEm?.test(sql)) throw ERRO_PG()
    if (sql === 'COMMIT') return { command: c.comandoCommit ?? 'COMMIT', rows: [], rowCount: null }
    if (/^INSERT/.test(sql)) return { rows: [], rowCount: sql.split('),(').length }
    if (/^UPDATE message_settings/.test(sql)) return { rows: [], rowCount: 2 }
    if (/FROM budget_items/.test(sql)) return { rows: (c.itensBanco ?? []).filter((r) => (params[1] as string[]).includes(r.id)) }
    if (/FROM budgets/.test(sql)) return { rows: (c.orcamentosBanco ?? []).filter((r) => (params[1] as string[]).includes(r.id)) }
    if (/FROM clinics/.test(sql)) return { rows: c.clinica === false ? [] : [{ id: CLINICA }] }
    if (/FROM professionals/.test(sql)) return { rows: c.profissional === false ? [] : [{ id: PROF }] }
    if (/FROM patients/.test(sql)) return { rows: [{ n: String(c.semVinculo ?? 0) }] }
    if (/FROM import_links/.test(sql)) return { rows: c.links ?? [] }
    if (/FROM insurance_plan_procedures/.test(sql)) return { rows: c.procedimentos ?? [] }
    if (/FROM insurance_plans/.test(sql)) return { rows: c.planos ?? [] }
    return { rows: [], rowCount: 0 }
  }

  get sqls() { return this.chamadas.map((c) => c.sql) }

  /** Linhas inseridas numa tabela, como objetos coluna -> valor. */
  inseridas(tabela: string): Linha[] {
    const saida: Linha[] = []
    for (const { sql, params } of this.chamadas) {
      const m = sql.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES \((.*)\)$/)
      if (!m || m[1] !== tabela) continue
      const colunas = m[2].split(', ')
      for (const grupo of m[3].split('),(')) {
        const tokens = grupo.split(',')
        saida.push(Object.fromEntries(colunas.map((col, i) => {
          const t = tokens[i]
          return [col, t === 'DEFAULT' ? 'DEFAULT' : params[Number(t.match(/^\$(\d+)/)![1]) - 1]]
        })))
      }
    }
    return saida
  }

  indice(re: RegExp) { return this.sqls.findIndex((s) => re.test(s)) }
  get escritas() { return this.sqls.filter((s) => /^(INSERT|UPDATE|DELETE)/.test(s)) }
}

const plano = () => ({
  convenios: [{ sourceId: 'C1', name: 'Plano Alfa' }],
  procedimentos: [{ sourceId: 'PR1', code: 'PR1', convenioSourceId: 'C1', name: 'Limpeza', price: 100.5, active: true, category: 'Geral' }],
  pacientes: [
    {
      sourceId: 'P1', numero: '1', name: NOME, cpf: CPF, phone: '11999998888', whatsapp: '11999998888', email: null,
      birthdate: '1990-01-02', gender: 'F', address: { street: 'Rua', complement: null, neighborhood: null, city: null, state: null, zip: null },
      convenioNome: 'Plano Alfa', insurance_card: '123', notes: 'nota', payer_name: null, payer_cpf: null,
      created_at: '2020-01-01T03:00:00.000Z', imported_from: 'codental',
    },
    {
      sourceId: 'P2', numero: '2', name: 'Outra', cpf: null, phone: null, whatsapp: null, email: null, birthdate: null, gender: null,
      address: null, convenioNome: null, insurance_card: null, notes: null, payer_name: null, payer_cpf: null,
      created_at: null, imported_from: 'codental',
    },
  ],
  consultas: [
    { sourceId: 'P1|d|0', pacienteSourceId: 'P1', start_time: '2024-01-01T12:00:00.000Z', end_time: '2024-01-01T12:30:00.000Z', status: 'completed', notes: null, imported_from: 'codental' },
    { sourceId: 'P2|d|0', pacienteSourceId: 'P2', start_time: '2030-01-01T12:00:00.000Z', end_time: '2030-01-01T12:30:00.000Z', status: 'scheduled', notes: null, imported_from: null },
  ],
  orcamentos: [
    {
      sourceId: 'O1', pacienteSourceId: 'P1', status: 'approved', total: 100.5, approved_total: 100.5, notes: null,
      created_at: '2023-01-01T03:00:00.000Z', imported_from: 'codental',
      itens: [{ sourceId: 'T1', procedure: 'Limpeza', tooth: '11, 12', quantity: 1, unit_price: 100.5, approved: true }] as ItemPlano[],
    },
    { sourceId: 'O2', pacienteSourceId: 'P2', status: 'draft', total: 0, approved_total: null, notes: null, created_at: null, imported_from: 'codental', itens: [] as ItemPlano[] },
  ],
  tratamentos: [
    {
      sourceId: 'T1', pacienteSourceId: 'P1', orcamentoSourceId: 'O1', procedure: 'Limpeza', value: 100.5, date: '2023-01-01',
      status: 'completed', convenioNome: 'Plano Alfa', procedimentoSourceId: 'PR1',
      dentes: [{ tooth_number: 11, faces: ['V', 'M'] }, { tooth_number: 12, faces: ['V', 'M'] }],
      created_at: '2023-01-01T03:00:00.000Z', imported_from: 'codental',
    },
    {
      sourceId: 'T2', pacienteSourceId: 'P2', orcamentoSourceId: null, procedure: 'Canal', value: 0, date: '2023-02-01',
      status: 'planned', convenioNome: null, procedimentoSourceId: null, dentes: [], created_at: null, imported_from: null,
    },
  ],
  evolucoes: [{ sourceId: 'E1', pacienteSourceId: 'P1', date: '2023-01-01', description: 'texto', created_at: null }],
  historico: [{
    sourceId: 'P1|O1|x|0', pacienteSourceId: 'P1', orcamentoSourceId: 'O1', description: 'Parcela', amount: 50.25, due_date: '2023-02-01',
    paid_at: '2023-02-01', payment_method: 'pix', installment_number: 1, installment_count: 2, original_status: 'paid',
  }],
  avisos: {},
})

/** Vínculos de uma importação anterior completa, com alvos distintos. */
const linksDe = (p: ReturnType<typeof plano>): Link[] => {
  const pares: [string, { sourceId: string }[]][] = [
    ['convenio', p.convenios], ['procedimento', p.procedimentos], ['paciente', p.pacientes], ['consulta', p.consultas],
    ['orcamento', p.orcamentos], ['item_orcamento', p.orcamentos.flatMap((o) => o.itens)], ['tratamento', p.tratamentos],
    ['evolucao', p.evolucoes], ['historico', p.historico],
  ]
  let n = 0
  return pares.flatMap(([entity, linhas]) => linhas.map((l) => ({
    entity, source_id: l.sourceId, target_id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(++n).padStart(12, '0')}`,
  })))
}

/** Banco coerente com os vínculos: orçamentos e itens onde a importação anterior os deixou. */
const estadoDe = (p: ReturnType<typeof plano>, links: Link[] = linksDe(p)): Config => {
  const mapa = new Map(links.map((l) => [`${l.entity}|${l.source_id}`, l.target_id]))
  const orcamentosBanco: { id: string; patient_id: string }[] = []
  const itensBanco: { id: string; budget_id: string }[] = []
  for (const o of p.orcamentos) {
    const id = mapa.get(`orcamento|${o.sourceId}`)
    if (!id) continue
    orcamentosBanco.push({ id, patient_id: mapa.get(`paciente|${o.pacienteSourceId}`)! })
    for (const i of o.itens) {
      const item = mapa.get(`item_orcamento|${i.sourceId}`)
      if (item) itensBanco.push({ id: item, budget_id: id })
    }
  }
  return { links, orcamentosBanco, itensBanco }
}

async function erroDe(f: () => Promise<unknown>): Promise<Error> {
  try { await f() } catch (e) { return e as Error }
  throw new Error('esperava erro')
}

describe('gravarPlano: transação', () => {
  it('roda tudo entre BEGIN e COMMIT, na ordem combinada', async () => {
    const c = new ClienteFalso()
    await gravarPlano(c, plano(), opts)
    expect(c.sqls[0]).toBe('BEGIN')
    expect(c.sqls.at(-1)).toBe('COMMIT')
    const ordem = ['insurance_plans', 'insurance_plan_procedures', 'patients', 'appointments', 'budgets', 'budget_items',
      'treatments', 'treatment_teeth', 'evolutions', 'legacy_payments', 'import_links']
      .map((t) => c.indice(new RegExp(`^INSERT INTO ${t} `)))
    expect(ordem.every((v) => v > 0)).toBe(true)
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem)
    expect(c.indice(/^UPDATE message_settings/)).toBeGreaterThan(ordem.at(-1)!)
  })

  it('erro gera ROLLBACK e relança só entidade, código e restrição', async () => {
    const c = new ClienteFalso({ falharEm: /^INSERT INTO patients/ })
    const e = await erroDe(() => gravarPlano(c, plano(), opts))
    expect(c.sqls.at(-1)).toBe('ROLLBACK')
    expect(c.sqls).not.toContain('COMMIT')
    expect(e.message).toContain('paciente')
    expect(e.message).toContain('23505')
    expect(e.message).toContain('patients_pkey')
    const tudo = JSON.stringify({ m: e.message, s: e.stack, c: (e as Error & { cause?: unknown }).cause, ...e })
    for (const p of [NOME, CPF, 'Key (']) expect(tudo).not.toContain(p)
  })

  it('falha no próprio ROLLBACK não troca o erro seguro', async () => {
    const c = new ClienteFalso({ falharEm: /^(INSERT INTO patients|ROLLBACK)/ })
    const e = await erroDe(() => gravarPlano(c, plano(), opts))
    expect(e.message).toContain('23505')
    expect(e.message).not.toContain(NOME)
  })

  it('COMMIT que o servidor converte em ROLLBACK é erro', async () => {
    const c = new ClienteFalso({ comandoCommit: 'ROLLBACK' })
    await expect(gravarPlano(c, plano(), opts)).rejects.toThrow(/confirmad|commit/i)
  })

  it('falha no COMMIT avisa que o estado precisa ser conferido', async () => {
    const c = new ClienteFalso({ falharEm: /^COMMIT/ })
    await expect(gravarPlano(c, plano(), opts)).rejects.toThrow(/confira/i)
  })

  it('liga app.budget_system antes dos orçamentos e desliga depois dos itens', async () => {
    const c = new ClienteFalso()
    await gravarPlano(c, plano(), opts)
    const liga = c.chamadas.findIndex((x) => /set_config\('app\.budget_system', 'on', true\)/.test(x.sql))
    const desliga = c.chamadas.findIndex((x) => /set_config\('app\.budget_system', 'off', true\)/.test(x.sql))
    expect(liga).toBeGreaterThan(0)
    expect(liga).toBeLessThan(c.indice(/^INSERT INTO budgets /))
    expect(desliga).toBeGreaterThan(c.indice(/^INSERT INTO budget_items /))
  })

  it('desliga só recall e birthday, na mesma transação', async () => {
    const c = new ClienteFalso()
    await gravarPlano(c, plano(), opts)
    const u = c.chamadas.filter((x) => /^UPDATE message_settings/.test(x.sql))
    expect(u).toHaveLength(1)
    expect(u[0].sql).toMatch(/enabled = false/)
    expect(u[0].params).toEqual([CLINICA, ['recall', 'birthday']])
    expect(c.indice(/^UPDATE message_settings/)).toBeLessThan(c.sqls.indexOf('COMMIT'))
  })

  it('divide em lotes abaixo do limite de parâmetros', async () => {
    const p = plano()
    p.evolucoes = Array.from({ length: 5000 }, (_, i) => ({ ...p.evolucoes[0], sourceId: `E${i}` }))
    const c = new ClienteFalso()
    await gravarPlano(c, p, opts)
    expect(Math.max(...c.chamadas.map((x) => x.params.length))).toBeLessThan(65535)
    expect(c.chamadas.filter((x) => /^INSERT INTO evolutions/.test(x.sql)).length).toBeGreaterThan(1)
    expect(c.inseridas('evolutions')).toHaveLength(5000)
  })

  it('insert com rowCount inesperado aborta', async () => {
    const c = new ClienteFalso()
    const orig = c.query.bind(c)
    c.query = async (s: string, pa: unknown[] = []) => (/^INSERT INTO patients/.test(s) ? (c.chamadas.push({ sql: s, params: pa }), { rows: [], rowCount: 1 }) : orig(s, pa))
    await expect(gravarPlano(c, plano(), opts)).rejects.toThrow(/paciente/)
    expect(c.sqls.at(-1)).toBe('ROLLBACK')
  })
})

describe('gravarPlano: colunas', () => {
  it('grava paciente com convênio, endereço JSON e omite created_at nulo', async () => {
    const c = new ClienteFalso()
    await gravarPlano(c, plano(), opts)
    const [plan] = c.inseridas('insurance_plans')
    const [p1, p2] = c.inseridas('patients')
    expect(p1).toMatchObject({ clinic_id: CLINICA, name: NOME, insurance_plan_id: plan.id, insurance_card: '123', imported_from: 'codental', created_at: '2020-01-01T03:00:00.000Z' })
    expect(JSON.parse(p1.address as string).street).toBe('Rua')
    expect(p2).toMatchObject({ address: null, insurance_plan_id: null, created_at: 'DEFAULT' })
    expect(p1).not.toHaveProperty('numero')
  })

  it('procedimento grava price em value e usa code', async () => {
    const c = new ClienteFalso()
    await gravarPlano(c, plano(), opts)
    const [plan] = c.inseridas('insurance_plans')
    expect(c.inseridas('insurance_plan_procedures')[0]).toMatchObject({
      clinic_id: CLINICA, insurance_plan_id: plan.id, code: 'PR1', name: 'Limpeza', value: 100.5, active: true,
    })
  })

  it('usa professionalId e imported_from do plano', async () => {
    const c = new ClienteFalso()
    await gravarPlano(c, plano(), opts)
    for (const t of ['appointments', 'treatments', 'evolutions', 'budgets']) {
      for (const l of c.inseridas(t)) expect(l.professional_id).toBe(PROF)
    }
    expect(c.inseridas('appointments').map((a) => a.imported_from)).toEqual(['codental', null])
    expect(c.inseridas('treatments').map((a) => a.imported_from)).toEqual(['codental', null])
  })

  it('tratamento liga convênio, procedimento e dentes', async () => {
    const c = new ClienteFalso()
    await gravarPlano(c, plano(), opts)
    const [t1, t2] = c.inseridas('treatments')
    expect(t1.insurance_plan_id).toBe(c.inseridas('insurance_plans')[0].id)
    expect(t1.insurance_procedure_id).toBe(c.inseridas('insurance_plan_procedures')[0].id)
    expect(t2.insurance_plan_id).toBeNull()
    const dentes = c.inseridas('treatment_teeth')
    expect(dentes).toHaveLength(2)
    expect(dentes[0]).toMatchObject({ treatment_id: t1.id, tooth_number: 11, faces: ['V', 'M'] })
  })

  it('orçamento mantém total e approved_total; itens apontam para ele', async () => {
    const c = new ClienteFalso()
    await gravarPlano(c, plano(), opts)
    const [o1, o2] = c.inseridas('budgets')
    expect(o1).toMatchObject({ status: 'approved', total: 100.5, approved_total: 100.5 })
    expect(o2).toMatchObject({ status: 'draft', approved_total: null, created_at: 'DEFAULT' })
    expect(o1).not.toHaveProperty('sent_at')
    expect(c.inseridas('budget_items')[0]).toMatchObject({ budget_id: o1.id, tooth: '11, 12', quantity: 1, unit_price: 100.5, approved: true })
  })

  it('histórico grava em legacy_payments com source_id', async () => {
    const c = new ClienteFalso()
    await gravarPlano(c, plano(), opts)
    expect(c.inseridas('legacy_payments')[0]).toMatchObject({
      clinic_id: CLINICA, source_id: 'P1|O1|x|0', budget_id: c.inseridas('budgets')[0].id, amount: 50.25, paid_at: '2023-02-01', original_status: 'paid',
    })
  })

  it('cria um vínculo por registro, com source codental e o id gravado', async () => {
    const c = new ClienteFalso()
    const p = plano()
    await gravarPlano(c, p, opts)
    const links = c.inseridas('import_links')
    expect(links).toHaveLength(linksDe(p).length)
    expect(links.every((l) => l.source === 'codental' && l.clinic_id === CLINICA)).toBe(true)
    const pac = links.find((l) => l.entity === 'paciente' && l.source_id === 'P1')!
    expect(pac.target_id).toBe(c.inseridas('patients')[0].id)
    const item = links.find((l) => l.entity === 'item_orcamento')!
    expect(item.target_id).toBe(c.inseridas('budget_items')[0].id)
  })
})

describe('gravarPlano: idempotência', () => {
  it('registro já vinculado não gera INSERT nem UPDATE', async () => {
    const p = plano()
    const c = new ClienteFalso(estadoDe(p))
    const r = await gravarPlano(c, p, opts)
    expect(c.escritas).toEqual([])
    expect(r.inseridos.paciente).toBe(0)
    expect(r.jaVinculados.paciente).toBe(2)
  })

  it('primeira importação desliga recall e birthday e informa a contagem', async () => {
    const c = new ClienteFalso()
    const r = await gravarPlano(c, plano(), opts)
    const u = c.chamadas.filter((x) => /^UPDATE message_settings/.test(x.sql))
    expect(u).toHaveLength(1)
    expect(u[0].params).toEqual([CLINICA, ['recall', 'birthday']])
    expect(r.mensagensDesativadas).toBe(2)
  })

  it('reexecução com linhas novas não mexe em message_settings', async () => {
    const p = plano()
    const links = linksDe(p).filter((l) => l.entity !== 'evolucao')
    const c = new ClienteFalso(estadoDe(p, links))
    const r = await gravarPlano(c, p, opts)
    expect(c.inseridas('evolutions')).toHaveLength(1)
    expect(c.sqls.some((s) => /message_settings/.test(s))).toBe(false)
    expect(r.mensagensDesativadas).toBe(0)
  })

  it('aceita orçamento novo com itens novos em reexecução com permitirNovos', async () => {
    const p = plano()
    const links = linksDe(p)
    p.orcamentos.push({
      sourceId: 'O3', pacienteSourceId: 'P2', status: 'draft', total: 10, approved_total: null, notes: null, created_at: null,
      imported_from: 'codental',
      itens: [{ sourceId: 'T3', procedure: 'Canal', tooth: null, quantity: 1, unit_price: 10, approved: null }],
    })
    const c = new ClienteFalso(estadoDe(p, links))
    await gravarPlano(c, p, { ...opts, permitirNovos: true })
    expect(c.sqls.at(-1)).toBe('COMMIT')
    const [novo] = c.inseridas('budgets')
    expect(c.inseridas('budgets')).toHaveLength(1)
    expect(c.inseridas('budget_items')).toHaveLength(1)
    expect(c.inseridas('budget_items')[0].budget_id).toBe(novo.id)
  })

  it('insere só o que falta e aponta para o alvo já vinculado', async () => {
    const p = plano()
    const links = linksDe(p).filter((l) => !(l.entity === 'evolucao'))
    const alvoPaciente = links.find((l) => l.entity === 'paciente' && l.source_id === 'P1')!.target_id
    const c = new ClienteFalso(estadoDe(p, links))
    await gravarPlano(c, p, opts)
    expect(c.inseridas('patients')).toEqual([])
    expect(c.inseridas('evolutions')).toHaveLength(1)
    expect(c.inseridas('evolutions')[0].patient_id).toBe(alvoPaciente)
    expect(c.inseridas('import_links').map((l) => l.entity)).toEqual(['evolucao'])
  })

  it('não insere dentes de tratamento já vinculado', async () => {
    const p = plano()
    const c = new ClienteFalso(estadoDe(p))
    await gravarPlano(c, p, opts)
    expect(c.inseridas('treatment_teeth')).toEqual([])
  })
})

describe('gravarPlano: reaproveitamento', () => {
  it('reusa convênio de mesmo nome (caixa e espaços) e só cria o vínculo', async () => {
    const c = new ClienteFalso({ planos: [{ id: ALVO, name: '  plano ALFA ' }] })
    const r = await gravarPlano(c, plano(), opts)
    expect(c.inseridas('insurance_plans')).toEqual([])
    expect(c.inseridas('patients')[0].insurance_plan_id).toBe(ALVO)
    expect(c.inseridas('import_links').find((l) => l.entity === 'convenio')!.target_id).toBe(ALVO)
    expect(r.reaproveitados.convenio).toBe(1)
  })

  it('recusa quando dois convênios existentes têm o mesmo nome', async () => {
    const c = new ClienteFalso({ planos: [{ id: ALVO, name: 'Plano Alfa' }, { id: ALVO2, name: 'plano alfa' }] })
    await expect(gravarPlano(c, plano(), opts)).rejects.toThrow(/convênio/i)
    expect(c.escritas).toEqual([])
  })

  it('recusa reusar convênio já vinculado a outro id de origem', async () => {
    const c = new ClienteFalso({
      planos: [{ id: ALVO, name: 'Plano Alfa' }],
      links: [{ entity: 'convenio', source_id: 'OUTRO', target_id: ALVO }],
    })
    await expect(gravarPlano(c, plano(), opts)).rejects.toThrow(/convênio/i)
    expect(c.escritas).toEqual([])
  })

  it('liga procedimento existente (plano, código) sem inserir', async () => {
    const c = new ClienteFalso({
      planos: [{ id: ALVO, name: 'Plano Alfa' }],
      procedimentos: [{ id: ALVO2, insurance_plan_id: ALVO, code: 'PR1' }],
    })
    const r = await gravarPlano(c, plano(), opts)
    expect(c.inseridas('insurance_plan_procedures')).toEqual([])
    expect(c.inseridas('treatments')[0].insurance_procedure_id).toBe(ALVO2)
    expect(r.reaproveitados.procedimento).toBe(1)
  })

  it('recusa procedimento existente já vinculado a outro id de origem', async () => {
    const c = new ClienteFalso({
      planos: [{ id: ALVO, name: 'Plano Alfa' }],
      procedimentos: [{ id: ALVO2, insurance_plan_id: ALVO, code: 'PR1' }],
      links: [{ entity: 'procedimento', source_id: 'OUTRO', target_id: ALVO2 }],
    })
    await expect(gravarPlano(c, plano(), opts)).rejects.toThrow(/procedimento/i)
    expect(c.escritas).toEqual([])
  })
})

describe('gravarPlano: verificações antes de gravar', () => {
  const recusa = async (cfg: Config, mudar: (p: ReturnType<typeof plano>) => void, re: RegExp, o = {}) => {
    const p = plano()
    mudar(p)
    const c = new ClienteFalso(cfg)
    const e = await erroDe(() => gravarPlano(c, p, { ...opts, ...o }))
    expect(e.message).toMatch(re)
    expect(c.escritas).toEqual([])
    expect(c.sqls.at(-1)).toBe('ROLLBACK')
    expect(c.sqls).not.toContain('COMMIT')
    for (const v of [NOME, CPF, 'Plano Alfa', 'X'.repeat(31)]) expect(e.message).not.toContain(v)
    return e
  }

  it('clínica inexistente aborta', () => recusa({ clinica: false }, () => {}, /clínica/i))
  it('profissional de outra clínica aborta', () => recusa({ profissional: false }, () => {}, /profissional/i))

  it('convênio de paciente fora do plano aborta', () => recusa({}, (p) => { p.pacientes[0].convenioNome = 'Plano Alfa 2' }, /paciente.*1/i))
  it('convênio de tratamento fora do plano aborta', () => recusa({}, (p) => { p.tratamentos[1].convenioNome = 'Outro' as never }, /tratamento.*1/i))
  it('dois convênios com o mesmo nome abortam', () => recusa({}, (p) => { p.convenios.push({ sourceId: 'C2', name: ' plano alfa' }) }, /convênio/i))

  it('pacientes fora dos vínculos abortam com a contagem', async () => {
    const e = await recusa({ semVinculo: 7 }, () => {}, /7/)
    expect(e.message).toMatch(/permitir-existentes/)
  })
  it('--permitir-existentes libera', async () => {
    const c = new ClienteFalso({ semVinculo: 7 })
    await gravarPlano(c, plano(), { ...opts, permitirExistentes: true })
    expect(c.sqls.at(-1)).toBe('COMMIT')
  })

  it('reimportação com consulta ou histórico novos aborta e conta', async () => {
    const base = linksDe(plano()).filter((l) => !(l.entity === 'consulta' && l.source_id === 'P2|d|0') && l.entity !== 'historico')
    const e = await recusa(estadoDe(plano(), base), () => {}, /2/)
    expect(e.message).toMatch(/permitir-novos/)
  })
  it('--permitir-novos libera', async () => {
    const links = linksDe(plano()).filter((l) => l.entity !== 'historico')
    const c = new ClienteFalso(estadoDe(plano(), links))
    await gravarPlano(c, plano(), { ...opts, permitirNovos: true })
    expect(c.inseridas('legacy_payments')).toHaveLength(1)
  })
  it('primeira importação não precisa de --permitir-novos', async () => {
    const c = new ClienteFalso()
    await gravarPlano(c, plano(), opts)
    expect(c.sqls.at(-1)).toBe('COMMIT')
  })

  it('carteirinha acima de 30 caracteres aborta com entidade e contagem', () =>
    recusa({}, (p) => { p.pacientes[0].insurance_card = 'X'.repeat(31) }, /paciente.*1/i))
  it('código de procedimento acima de 20 caracteres aborta', () =>
    recusa({}, (p) => { p.procedimentos[0].code = 'X'.repeat(21) }, /procedimento.*1/i))
  it('valor acima de NUMERIC(10,2) aborta', () =>
    recusa({}, (p) => { p.historico[0].amount = 100000000 }, /histórico.*1/i))
  it('status fora do permitido aborta', () =>
    recusa({}, (p) => { p.consultas[0].status = 'outro' }, /consulta.*1/i))
  it('id de origem repetido aborta', () =>
    recusa({}, (p) => { p.evolucoes.push({ ...p.evolucoes[0] }) }, /evolu/i))
  it('referência a paciente ausente aborta', () =>
    recusa({}, (p) => { p.consultas[0].pacienteSourceId = 'NAO' }, /consulta.*1/i))
  it('procedimento de outro convênio no tratamento aborta', () =>
    recusa({}, (p) => { p.tratamentos[0].convenioNome = null as never }, /tratamento.*1/i))

  it.each([false, true])('item novo em orçamento já vinculado aborta (permitirNovos: %s)', async (permitirNovos) => {
    await recusa(estadoDe(plano()), (p) => {
      p.orcamentos[0].itens.push({ sourceId: 'T9', procedure: 'Extra', tooth: '13', quantity: 1, unit_price: 5, approved: true })
    }, /item de orçamento.*\(1\)/i, { permitirNovos })
  })

  const novoOrcamento = (itens: ItemPlano[]) => ({
    sourceId: 'O3', pacienteSourceId: 'P1', status: 'draft', total: 100.5, approved_total: null, notes: null, created_at: null,
    imported_from: 'codental', itens,
  })

  it.each([false, true])('item vinculado movido para orçamento novo aborta (permitirNovos: %s)', async (permitirNovos) => {
    await recusa(estadoDe(plano()), (p) => {
      p.orcamentos.push(novoOrcamento(p.orcamentos[0].itens.splice(0)))
    }, /item de orçamento.*outro orçamento.*\(1\)/i, { permitirNovos })
  })

  it('item vinculado e já apagado, movido para orçamento novo, aborta', async () => {
    const estado = { ...estadoDe(plano()), itensBanco: [] }
    await recusa(estado, (p) => {
      p.orcamentos.push(novoOrcamento(p.orcamentos[0].itens.splice(0)))
    }, /item de orçamento.*outro orçamento.*\(1\)/i)
  })

  it.each([false, true])('item movido entre orçamentos vinculados aborta (permitirNovos: %s)', async (permitirNovos) => {
    await recusa(estadoDe(plano()), (p) => {
      p.orcamentos[1].itens.push(...p.orcamentos[0].itens.splice(0))
    }, /item de orçamento.*outro orçamento.*\(1\)/i, { permitirNovos })
  })

  it.each([false, true])('orçamento vinculado com outro paciente no banco aborta (permitirNovos: %s)', async (permitirNovos) => {
    const links = linksDe(plano()).filter((l) => l.entity !== 'historico')
    await recusa(estadoDe(plano(), links), (p) => {
      p.orcamentos[0].pacienteSourceId = 'P2'
      p.tratamentos[0].pacienteSourceId = 'P2'
      p.historico[0].pacienteSourceId = 'P2'
    }, /orçamento: paciente diferente.*\(1\)/i, { permitirNovos })
  })

  it('orçamento vinculado passado a paciente novo aborta', async () => {
    await recusa(estadoDe(plano()), (p) => {
      p.pacientes.push({ ...p.pacientes[1], sourceId: 'P3' })
      p.orcamentos[0].pacienteSourceId = 'P3'
      p.tratamentos[0].pacienteSourceId = 'P3'
      p.historico[0].pacienteSourceId = 'P3'
    }, /orçamento: paciente diferente.*\(1\)/i, { permitirNovos: true })
  })

  it('histórico novo em orçamento vinculado ausente da clínica aborta', async () => {
    const links = linksDe(plano()).filter((l) => l.entity !== 'historico')
    await recusa({ ...estadoDe(plano(), links), orcamentosBanco: [] }, () => {}, /histórico.*não encontrado.*\(1\)/i, { permitirNovos: true })
  })

  it('lê orçamentos e itens vinculados em lotes, limitados à clínica', async () => {
    const p = plano()
    const [o1] = p.orcamentos
    p.orcamentos = Array.from({ length: 1200 }, (_, i) => ({
      ...o1, sourceId: i === 0 ? 'O1' : `O${i + 10}`,
      itens: [{ ...o1.itens[0], sourceId: i === 0 ? 'T1' : `I${i}` }],
    }))
    const c = new ClienteFalso(estadoDe(p))
    await gravarPlano(c, p, opts)
    for (const [re, escopo] of [[/FROM budgets/, /clinic_id = \$1/], [/FROM budget_items/, /b\.clinic_id = \$1/]] as const) {
      const leituras = c.chamadas.filter((x) => /^SELECT/.test(x.sql) && re.test(x.sql))
      expect(leituras.length).toBeGreaterThan(1)
      expect(leituras.flatMap((x) => x.params[1] as string[])).toHaveLength(1200)
      for (const l of leituras) {
        expect(l.sql).toMatch(escopo)
        expect(l.params[0]).toBe(CLINICA)
        expect((l.params[1] as string[]).length).toBeLessThanOrEqual(1000)
      }
    }
    expect(c.indice(/FROM budget_items/)).toBeLessThan(c.sqls.indexOf('COMMIT'))
  })

  it('tratamento em orçamento de outro paciente aborta', () =>
    recusa({}, (p) => { p.tratamentos[1].orcamentoSourceId = 'O1' as never }, /tratamento.*outro paciente.*\(1\)/i))

  it('histórico em orçamento de outro paciente aborta', () =>
    recusa({}, (p) => { p.historico[0].pacienteSourceId = 'P2' }, /histórico.*outro paciente.*\(1\)/i))

  it('linha já vinculada não é validada de novo', async () => {
    const p = plano()
    p.pacientes[0].insurance_card = 'X'.repeat(31)
    const c = new ClienteFalso(estadoDe(p))
    await gravarPlano(c, p, opts)
    expect(c.sqls.at(-1)).toBe('COMMIT')
  })
})

describe('configConexao', () => {
  const URL_OK = 'postgresql://usuario:s%40nha@db.exemplo.test:6543/postgres'

  it('monta campos explícitos com verificação de certificado', () => {
    const cfg = configConexao(`${URL_OK}?sslmode=require`)
    expect(cfg).toMatchObject({ host: 'db.exemplo.test', port: 6543, user: 'usuario', password: 's@nha', database: 'postgres' })
    expect(cfg.ssl).toEqual({ rejectUnauthorized: true })
    expect(cfg).not.toHaveProperty('connectionString')
  })

  it.each(['disable', 'allow', 'prefer', 'no-verify'])('recusa sslmode=%s sem expor a URL', (modo) => {
    let msg = ''
    try { configConexao(`${URL_OK}?sslmode=${modo}`) } catch (e) { msg = (e as Error).message }
    expect(msg).toMatch(/TLS|sslmode/)
    expect(msg).not.toContain('s%40nha')
    expect(msg).not.toContain('exemplo')
  })

  it.each(['ssl=false', 'sslrootcert=/ca.pem', 'host=outro', 'uselibpqcompat=true'])('recusa parâmetro %s', (q) => {
    expect(() => configConexao(`${URL_OK}?${q}`)).toThrow(/parâmetro/i)
  })

  it('URL inválida não aparece no erro', () => {
    let msg = ''
    try { configConexao('segredo-nao-e-url') } catch (e) { msg = (e as Error).message }
    expect(msg).not.toBe('')
    expect(msg).not.toContain('segredo')
  })
})

describe('cli --gravar', () => {
  const limpar: string[] = []
  afterEach(async () => { while (limpar.length) await rm(limpar.pop()!, { recursive: true, force: true }) })
  const URL_BANCO = 'postgresql://usuario:senhasecreta@db.exemplo.test:5432/postgres'

  const preparar = async (over: Record<string, unknown> = {}, extra: string[] = ['--confirmar-clinica', CLINICA]) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'imp-'))
    limpar.push(dir)
    const out: string[] = []
    const err: string[] = []
    const estado = { leu: 0, conectou: 0, fechou: 0, cfg: null as unknown, opts: null as unknown }
    const codigo = await principal(
      ['--backup', 'pasta', '--clinica', CLINICA, '--profissional', PROF, '--saida', dir, '--gravar', ...extra],
      {
        lerBackup: async () => { estado.leu++; return {} },
        mapearBackup: () => plano(),
        agora: new Date('2026-06-01T12:00:00Z'),
        out: (s: string) => out.push(s),
        err: (s: string) => err.push(s),
        env: { IMPORT_DATABASE_URL: URL_BANCO },
        criarCliente: (cfg: unknown) => {
          estado.cfg = cfg
          return {
            connect: async () => { estado.conectou++ },
            end: async () => { estado.fechou++ },
            on: () => {},
            query: async () => ({ rows: [] }),
          }
        },
        gravarPlano: async (_c: unknown, _p: unknown, o: unknown) => {
          estado.opts = o
          return { inseridos: { paciente: 2 }, reaproveitados: {}, jaVinculados: {}, dentes: 0, mensagensDesativadas: 2 }
        },
        ...over,
      },
    )
    return { codigo, dir, out: out.join('\n'), err: err.join('\n'), estado }
  }

  it('normaliza clínica e profissional para minúsculas antes de mapear e gravar', async () => {
    const clinica = 'abcdefab-cdef-4abc-8abc-abcdefabcdef'
    const profissional = 'fedcbafe-dcba-4fed-8fed-fedcbafedcba'
    let mapeado: unknown = null
    const r = await preparar(
      { mapearBackup: (_b: unknown, o: unknown) => { mapeado = o; return plano() } },
      ['--clinica', clinica.toUpperCase(), '--profissional', profissional.toUpperCase(), '--confirmar-clinica', clinica.toUpperCase()],
    )
    expect(r.err).toBe('')
    expect(r.codigo).toBe(0)
    expect(r.estado.opts).toMatchObject({ clinicId: clinica, professionalId: profissional })
    expect(mapeado).toMatchObject({ clinicId: clinica, professionalId: profissional })
  })

  it('grava, salva resultado sem valores e fecha a conexão', async () => {
    const r = await preparar()
    expect(r.err).toBe('')
    expect(r.codigo).toBe(0)
    expect(r.estado.opts).toEqual({ clinicId: CLINICA, professionalId: PROF, permitirExistentes: false, permitirNovos: false })
    expect(r.estado.fechou).toBe(1)
    const json = await readFile(path.join(r.dir, 'resultado-gravacao.json'), 'utf8')
    expect(JSON.parse(json).inseridos.paciente).toBe(2)
    for (const s of [json, r.out]) for (const v of [NOME, CPF, 'senhasecreta', 'exemplo']) expect(s).not.toContain(v)
    expect(r.out).toContain('2')
  })

  it('repassa as permissões', async () => {
    const r = await preparar({}, ['--confirmar-clinica', CLINICA, '--permitir-existentes', '--permitir-novos'])
    expect(r.estado.opts).toMatchObject({ permitirExistentes: true, permitirNovos: true })
  })

  it('exige --confirmar-clinica igual a --clinica', async () => {
    const r = await preparar({}, ['--confirmar-clinica', PROF])
    expect(r.codigo).not.toBe(0)
    expect(r.err).toMatch(/confirmar-clinica/)
    expect(r.estado.leu).toBe(0)
    expect(r.estado.conectou).toBe(0)
  })

  it('sem IMPORT_DATABASE_URL sai antes de ler qualquer coisa', async () => {
    const r = await preparar({ env: {} })
    expect(r.codigo).not.toBe(0)
    expect(r.err).toMatch(/IMPORT_DATABASE_URL/)
    expect(r.estado.leu).toBe(0)
    expect(r.estado.conectou).toBe(0)
  })

  it('URL sem TLS verificável é recusada antes de ler o backup', async () => {
    const r = await preparar({ env: { IMPORT_DATABASE_URL: `${URL_BANCO}?sslmode=no-verify` } })
    expect(r.codigo).not.toBe(0)
    expect(r.estado.leu).toBe(0)
    expect(r.err).not.toContain('senhasecreta')
  })

  it('erro de conexão não expõe a URL e informa o código', async () => {
    const r = await preparar({
      criarCliente: () => ({
        connect: async () => { throw Object.assign(new Error(`falhou ${URL_BANCO}`), { code: 'SELF_SIGNED_CERT_IN_CHAIN' }) },
        end: async () => {}, on: () => {}, query: async () => ({ rows: [] }),
      }),
    })
    expect(r.codigo).not.toBe(0)
    expect(r.err).toContain('SELF_SIGNED_CERT_IN_CHAIN')
    expect(r.err).not.toContain('senhasecreta')
    expect(r.err).not.toContain('exemplo')
  })

  it('erro na gravação fecha a conexão e não cria resultado', async () => {
    const r = await preparar({ gravarPlano: async () => { throw new Error('Falha segura') } })
    expect(r.codigo).not.toBe(0)
    expect(r.err).toBe('Falha segura')
    expect(r.estado.fechou).toBe(1)
    await expect(readFile(path.join(r.dir, 'resultado-gravacao.json'), 'utf8')).rejects.toThrow()
  })
})
