// Grava o plano no banco em uma única transação. Verifica tudo antes do primeiro INSERT.
// Mensagens de erro trazem só entidade, contagem, código e restrição: nunca valores.
import { randomUUID } from 'node:crypto'

const FONTE = 'codental'
const MAX_PARAMETROS = 10000
const MAX_LINHAS = 500
const MAX_CARTEIRINHA = 30
const MAX_CODIGO = 20
const LIMITE_NUMERIC = 99999999.995 // NUMERIC(10,2)
const MAX_INT4 = 2147483647
const PADRAO = Symbol('DEFAULT')

const ROTULOS = {
  convenio: 'convênio', procedimento: 'procedimento', paciente: 'paciente', consulta: 'consulta',
  orcamento: 'orçamento', item_orcamento: 'item de orçamento', tratamento: 'tratamento',
  dente: 'dente', evolucao: 'evolução', historico: 'histórico', vinculo: 'vínculo', mensagem: 'mensagem',
}

const STATUS = {
  consulta: new Set(['scheduled', 'confirmed', 'waiting', 'in_progress', 'completed', 'cancelled', 'no_show']),
  tratamento: new Set(['planned', 'in_progress', 'completed', 'cancelled']),
  orcamento: new Set(['draft', 'sent', 'approved', 'rejected', 'expired', 'completed']),
  historico: new Set(['paid', 'open']),
}

const COLUNAS = {
  convenio: { id: 'uuid', clinic_id: 'uuid', name: 'text' },
  procedimento: {
    id: 'uuid', clinic_id: 'uuid', insurance_plan_id: 'uuid', code: 'text', name: 'text', value: 'numeric', active: 'boolean',
  },
  paciente: {
    id: 'uuid', clinic_id: 'uuid', name: 'text', cpf: 'text', phone: 'text', whatsapp: 'text', email: 'text', birthdate: 'date',
    gender: 'text', address: 'jsonb', insurance_plan_id: 'uuid', insurance_card: 'text', notes: 'text', payer_name: 'text',
    payer_cpf: 'text', imported_from: 'text', created_at: 'timestamptz',
  },
  consulta: {
    id: 'uuid', clinic_id: 'uuid', patient_id: 'uuid', professional_id: 'uuid', start_time: 'timestamptz', end_time: 'timestamptz',
    status: 'text', notes: 'text', imported_from: 'text',
  },
  orcamento: {
    id: 'uuid', clinic_id: 'uuid', patient_id: 'uuid', professional_id: 'uuid', status: 'text', total: 'numeric',
    approved_total: 'numeric', notes: 'text', imported_from: 'text', created_at: 'timestamptz',
  },
  item_orcamento: {
    id: 'uuid', budget_id: 'uuid', procedure: 'text', tooth: 'text', quantity: 'int', unit_price: 'numeric', approved: 'boolean',
  },
  tratamento: {
    id: 'uuid', clinic_id: 'uuid', patient_id: 'uuid', professional_id: 'uuid', insurance_plan_id: 'uuid',
    insurance_procedure_id: 'uuid', procedure: 'text', value: 'numeric', date: 'date', status: 'text', imported_from: 'text',
    created_at: 'timestamptz',
  },
  dente: { id: 'uuid', treatment_id: 'uuid', tooth_number: 'int', faces: 'text[]' },
  evolucao: {
    id: 'uuid', clinic_id: 'uuid', patient_id: 'uuid', professional_id: 'uuid', date: 'date', description: 'text', created_at: 'timestamptz',
  },
  historico: {
    id: 'uuid', clinic_id: 'uuid', patient_id: 'uuid', budget_id: 'uuid', source_id: 'text', description: 'text', amount: 'numeric',
    due_date: 'date', paid_at: 'date', payment_method: 'text', installment_number: 'int', installment_count: 'int', original_status: 'text',
  },
  vinculo: { clinic_id: 'uuid', source: 'text', entity: 'text', source_id: 'text', target_id: 'uuid' },
}

const TABELAS = {
  convenio: 'insurance_plans', procedimento: 'insurance_plan_procedures', paciente: 'patients', consulta: 'appointments',
  orcamento: 'budgets', item_orcamento: 'budget_items', tratamento: 'treatments', dente: 'treatment_teeth',
  evolucao: 'evolutions', historico: 'legacy_payments', vinculo: 'import_links',
}

export class ErroGravacao extends Error {
  constructor(mensagem) {
    super(mensagem)
    this.name = 'ErroGravacao'
  }
}

// ── Auxiliares ─────────────────────────────────────────────────────────────
const nomeComparavel = (nome) => String(nome).normalize('NFC').trim().toLocaleLowerCase('pt-BR')
const tamanho = (s) => [...s].length
const dinheiroOk = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < LIMITE_NUMERIC
const inteiroOk = (v) => Number.isInteger(v) && Math.abs(v) <= MAX_INT4
const textoOk = (v) => typeof v === 'string' && v.length > 0
const ouPadrao = (v) => (v === null || v === undefined ? PADRAO : v)

function criarProblemas() {
  const contagem = new Map()
  return {
    add(entidade, motivo) {
      const k = `${ROTULOS[entidade]}: ${motivo}`
      contagem.set(k, (contagem.get(k) ?? 0) + 1)
    },
    conferir(entidade, ok, motivo) {
      if (!ok) this.add(entidade, motivo)
    },
    lancar() {
      if (!contagem.size) return
      const partes = [...contagem].map(([k, n]) => `${k} (${n})`)
      throw new ErroGravacao(`Importação recusada. ${partes.join('; ')}`)
    },
  }
}

function erroSeguro(e, etapa) {
  if (e instanceof ErroGravacao) return e
  const codigo = typeof e?.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code) ? e.code : 'sem código'
  const restricao = typeof e?.constraint === 'string' && /^\w{1,63}$/.test(e.constraint) ? e.constraint : 'nenhuma'
  if (etapa === 'commit') {
    return new ErroGravacao(`Falha no COMMIT (código: ${codigo}). O resultado é incerto: confira o banco antes de repetir.`)
  }
  const rotulo = ROTULOS[etapa] ?? etapa
  return new ErroGravacao(`Falha ao gravar (entidade: ${rotulo}, código: ${codigo}, restrição: ${restricao}). Nada foi gravado.`)
}

async function inserir(cliente, entidade, linhas) {
  if (!linhas.length) return
  const colunas = Object.entries(COLUNAS[entidade])
  const porLote = Math.min(MAX_LINHAS, Math.floor(MAX_PARAMETROS / colunas.length))
  const nomes = colunas.map(([c]) => c).join(', ')

  for (let i = 0; i < linhas.length; i += porLote) {
    const lote = linhas.slice(i, i + porLote)
    const params = []
    const grupos = lote.map((linha) => {
      const marcadores = colunas.map(([coluna, tipo]) => {
        const v = linha[coluna]
        if (v === PADRAO) return 'DEFAULT'
        params.push(v === undefined ? null : v)
        return `$${params.length}::${tipo}`
      })
      return `(${marcadores.join(',')})`
    })
    const r = await cliente.query(`INSERT INTO ${TABELAS[entidade]} (${nomes}) VALUES ${grupos.join(',')}`, params)
    if (r.rowCount !== lote.length) {
      throw new ErroGravacao(`Falha ao gravar (entidade: ${ROTULOS[entidade]}): quantidade de linhas inesperada. Nada foi gravado.`)
    }
  }
}

// ── Verificações do plano ──────────────────────────────────────────────────
function conferirConvenios(plano, problemas) {
  const nomes = new Set()
  for (const c of plano.convenios) {
    const k = nomeComparavel(c.name)
    if (nomes.has(k)) problemas.add('convenio', 'nome repetido no plano')
    nomes.add(k)
  }
  const exatos = new Set(plano.convenios.map((c) => c.name))
  for (const [entidade, linhas] of [['paciente', plano.pacientes], ['tratamento', plano.tratamentos]]) {
    for (const l of linhas) {
      if (l.convenioNome !== null && !exatos.has(l.convenioNome)) problemas.add(entidade, 'convênio fora do plano')
    }
  }
}

/** Tratamento ou pagamento não pode apontar para orçamento de outro paciente. */
function conferirDonosDosOrcamentos(plano, problemas) {
  const donos = new Map(plano.orcamentos.map((o) => [o.sourceId, o.pacienteSourceId]))
  for (const [entidade, linhas] of [['tratamento', plano.tratamentos], ['historico', plano.historico]]) {
    for (const l of linhas) {
      if (l.orcamentoSourceId === null || l.orcamentoSourceId === undefined) continue
      const dono = donos.get(l.orcamentoSourceId)
      if (dono !== undefined && dono !== l.pacienteSourceId) problemas.add(entidade, 'orçamento de outro paciente')
    }
  }
}

async function lerPorIds(cliente, sql, clinicId, ids) {
  const unicos = [...new Set(ids)]
  const linhas = []
  for (let i = 0; i < unicos.length; i += MAX_LINHAS) {
    const { rows } = await cliente.query(sql, [clinicId, unicos.slice(i, i + MAX_LINHAS)])
    linhas.push(...rows)
  }
  return linhas
}

/**
 * Compara o plano com orçamentos e itens já gravados. Vínculos nunca são atualizados,
 * então troca de paciente, item novo em orçamento importado e item movido abortam.
 * Registro vinculado que a clínica apagou depois não é recriado nem bloqueia,
 * salvo se uma linha nova dependeria dele.
 */
async function conferirOrcamentosVinculados(cliente, plano, vinculos, clinicId, problemas) {
  const orcamentos = vinculos.de('orcamento')
  const itens = vinculos.de('item_orcamento')
  const pacientes = vinculos.de('paciente')
  const historico = vinculos.de('historico')

  const alvosOrcamento = plano.orcamentos.map((o) => orcamentos.get(o.sourceId)).filter(Boolean)
  const alvosItem = plano.orcamentos.flatMap((o) => o.itens).map((i) => itens.get(i.sourceId)).filter(Boolean)
  const donos = new Map((await lerPorIds(
    cliente,
    'SELECT id, patient_id FROM budgets WHERE clinic_id = $1 AND id = ANY($2::uuid[])',
    clinicId,
    alvosOrcamento,
  )).map((r) => [r.id, r.patient_id]))
  const atuais = new Map((await lerPorIds(
    cliente,
    `SELECT bi.id, bi.budget_id FROM budget_items bi
     JOIN budgets b ON b.id = bi.budget_id
     WHERE b.clinic_id = $1 AND bi.id = ANY($2::uuid[])`,
    clinicId,
    alvosItem,
  )).map((r) => [r.id, r.budget_id]))

  for (const o of plano.orcamentos) {
    const alvo = orcamentos.get(o.sourceId)
    if (alvo && donos.has(alvo) && donos.get(alvo) !== pacientes.get(o.pacienteSourceId)) {
      problemas.add('orcamento', 'paciente diferente do já importado')
    }
    for (const i of o.itens) {
      const item = itens.get(i.sourceId)
      if (!item) {
        if (alvo) problemas.add('item_orcamento', 'novo em orçamento já importado')
      } else if (!alvo || (atuais.has(item) && atuais.get(item) !== alvo)) {
        problemas.add('item_orcamento', 'vinculado a outro orçamento')
      }
    }
  }

  for (const h of plano.historico) {
    if (historico.has(h.sourceId)) continue
    const alvo = orcamentos.get(h.orcamentoSourceId)
    if (alvo && !donos.has(alvo)) problemas.add('historico', 'orçamento vinculado não encontrado na clínica')
  }
}

function conferirIdsUnicos(fontes, problemas) {
  for (const [entidade, linhas] of Object.entries(fontes)) {
    const vistos = new Set()
    for (const l of linhas) {
      if (!textoOk(l.sourceId) || vistos.has(l.sourceId)) problemas.add(entidade, 'id de origem ausente ou repetido')
      vistos.add(l.sourceId)
    }
  }
}

function indexarVinculos(rows) {
  const porEntidade = new Map()
  const alvos = new Map()
  for (const r of rows) {
    if (!porEntidade.has(r.entity)) {
      porEntidade.set(r.entity, new Map())
      alvos.set(r.entity, new Set())
    }
    porEntidade.get(r.entity).set(r.source_id, r.target_id)
    alvos.get(r.entity).add(r.target_id)
  }
  return {
    total: rows.length,
    de: (entidade) => porEntidade.get(entidade) ?? new Map(),
    alvos: (entidade) => alvos.get(entidade) ?? new Set(),
  }
}

/** Decide, para cada convênio sem vínculo, entre reaproveitar e criar. */
function resolverConvenios(plano, vinculos, existentes, ids, problemas) {
  const porNome = new Map()
  for (const r of existentes) {
    const k = nomeComparavel(r.name)
    if (!porNome.has(k)) porNome.set(k, [])
    porNome.get(k).push(r.id)
  }
  const novos = []
  const reaproveitados = []
  const ligados = vinculos.de('convenio')
  for (const c of plano.convenios) {
    if (ligados.has(c.sourceId)) {
      ids.convenio.set(c.sourceId, ligados.get(c.sourceId))
      continue
    }
    const iguais = porNome.get(nomeComparavel(c.name)) ?? []
    if (iguais.length > 1) {
      problemas.add('convenio', 'mais de um cadastro com o mesmo nome na clínica')
    } else if (iguais.length === 1) {
      if (vinculos.alvos('convenio').has(iguais[0])) problemas.add('convenio', 'cadastro já vinculado a outro id de origem')
      ids.convenio.set(c.sourceId, iguais[0])
      reaproveitados.push(c)
    } else {
      ids.convenio.set(c.sourceId, randomUUID())
      novos.push(c)
    }
  }
  return { novos, reaproveitados }
}

function resolverProcedimentos(plano, vinculos, existentes, ids, problemas) {
  const porChave = new Map(existentes.map((r) => [`${r.insurance_plan_id}|${r.code}`, r.id]))
  const novos = []
  const reaproveitados = []
  const chaves = new Set()
  const ligados = vinculos.de('procedimento')
  for (const p of plano.procedimentos) {
    if (ligados.has(p.sourceId)) {
      ids.procedimento.set(p.sourceId, ligados.get(p.sourceId))
      continue
    }
    const planoId = ids.convenio.get(p.convenioSourceId)
    if (!planoId) {
      problemas.add('procedimento', 'convênio inexistente no plano')
      continue
    }
    const chave = `${planoId}|${p.code}`
    if (chaves.has(chave)) problemas.add('procedimento', 'código repetido no mesmo convênio')
    chaves.add(chave)
    const existente = porChave.get(chave)
    if (existente) {
      if (vinculos.alvos('procedimento').has(existente)) problemas.add('procedimento', 'cadastro já vinculado a outro id de origem')
      ids.procedimento.set(p.sourceId, existente)
      reaproveitados.push(p)
    } else {
      ids.procedimento.set(p.sourceId, randomUUID())
      novos.push(p)
    }
  }
  return { novos, reaproveitados }
}

// ── Montagem das linhas (sem tocar no banco) ───────────────────────────────
function montarLinhas(plano, fontes, vinculos, ids, resolvidos, { clinicId, professionalId }, problemas) {
  const novos = {}
  for (const [entidade, linhas] of Object.entries(fontes)) {
    if (entidade === 'convenio' || entidade === 'procedimento') continue
    const ligados = vinculos.de(entidade)
    novos[entidade] = []
    for (const l of linhas) {
      if (ligados.has(l.sourceId)) {
        ids[entidade].set(l.sourceId, ligados.get(l.sourceId))
      } else {
        ids[entidade].set(l.sourceId, randomUUID())
        novos[entidade].push(l)
      }
    }
  }

  const ref = (entidadeLinha, alvo, sourceId) => {
    const id = ids[alvo].get(sourceId)
    if (!id) problemas.add(entidadeLinha, `referência a ${ROTULOS[alvo]} inexistente`)
    return id ?? null
  }
  const refOpcional = (entidadeLinha, alvo, sourceId) =>
    sourceId === null || sourceId === undefined ? null : ref(entidadeLinha, alvo, sourceId)

  const convenioPorNome = new Map(plano.convenios.map((c) => [c.name, c]))
  const planoDoNome = (nome) => {
    if (nome === null || nome === undefined) return null
    const c = convenioPorNome.get(nome)
    return c ? ids.convenio.get(c.sourceId) ?? null : null
  }
  const convenioDoProcedimento = new Map(plano.procedimentos.map((p) => [p.sourceId, p.convenioSourceId]))
  const donoDoItem = new Map()
  for (const o of plano.orcamentos) for (const i of o.itens) donoDoItem.set(i.sourceId, o.sourceId)

  const linhas = {}

  linhas.convenio = resolvidos.convenio.novos.map((c) => {
    problemas.conferir('convenio', textoOk(c.name), 'nome ausente')
    return { id: ids.convenio.get(c.sourceId), clinic_id: clinicId, name: c.name }
  })

  linhas.procedimento = resolvidos.procedimento.novos.map((p) => {
    problemas.conferir('procedimento', textoOk(p.code) && tamanho(p.code) <= MAX_CODIGO, `código vazio ou acima de ${MAX_CODIGO} caracteres`)
    problemas.conferir('procedimento', textoOk(p.name), 'nome ausente')
    problemas.conferir('procedimento', dinheiroOk(p.price) && p.price >= 0, 'valor fora do limite')
    return {
      id: ids.procedimento.get(p.sourceId), clinic_id: clinicId, insurance_plan_id: ids.convenio.get(p.convenioSourceId),
      code: p.code, name: p.name, value: p.price, active: p.active,
    }
  })

  linhas.paciente = novos.paciente.map((p) => {
    problemas.conferir('paciente', textoOk(p.name), 'nome ausente')
    problemas.conferir('paciente', p.insurance_card === null || tamanho(p.insurance_card) <= MAX_CARTEIRINHA, `carteirinha acima de ${MAX_CARTEIRINHA} caracteres`)
    return {
      id: ids.paciente.get(p.sourceId), clinic_id: clinicId, name: p.name, cpf: p.cpf, phone: p.phone, whatsapp: p.whatsapp,
      email: p.email, birthdate: p.birthdate, gender: p.gender, address: p.address === null ? null : JSON.stringify(p.address),
      insurance_plan_id: planoDoNome(p.convenioNome), insurance_card: p.insurance_card, notes: p.notes,
      payer_name: p.payer_name, payer_cpf: p.payer_cpf, imported_from: p.imported_from, created_at: ouPadrao(p.created_at),
    }
  })

  linhas.consulta = novos.consulta.map((c) => {
    problemas.conferir('consulta', STATUS.consulta.has(c.status), 'status não permitido')
    problemas.conferir('consulta', textoOk(c.start_time) && textoOk(c.end_time), 'horário ausente')
    return {
      id: ids.consulta.get(c.sourceId), clinic_id: clinicId, patient_id: ref('consulta', 'paciente', c.pacienteSourceId),
      professional_id: professionalId, start_time: c.start_time, end_time: c.end_time, status: c.status, notes: c.notes,
      imported_from: c.imported_from,
    }
  })

  linhas.orcamento = novos.orcamento.map((o) => {
    problemas.conferir('orcamento', STATUS.orcamento.has(o.status), 'status não permitido')
    problemas.conferir('orcamento', dinheiroOk(o.total), 'valor fora do limite')
    problemas.conferir('orcamento', o.approved_total === null || dinheiroOk(o.approved_total), 'valor fora do limite')
    return {
      id: ids.orcamento.get(o.sourceId), clinic_id: clinicId, patient_id: ref('orcamento', 'paciente', o.pacienteSourceId),
      professional_id: professionalId, status: o.status, total: o.total, approved_total: o.approved_total, notes: o.notes,
      imported_from: o.imported_from, created_at: ouPadrao(o.created_at),
    }
  })

  linhas.item_orcamento = novos.item_orcamento.map((i) => {
    problemas.conferir('item_orcamento', textoOk(i.procedure), 'procedimento ausente')
    problemas.conferir('item_orcamento', inteiroOk(i.quantity), 'quantidade inválida')
    problemas.conferir('item_orcamento', dinheiroOk(i.unit_price), 'valor fora do limite')
    return {
      id: ids.item_orcamento.get(i.sourceId), budget_id: ref('item_orcamento', 'orcamento', donoDoItem.get(i.sourceId)),
      procedure: i.procedure, tooth: i.tooth, quantity: i.quantity, unit_price: i.unit_price, approved: i.approved,
    }
  })

  linhas.dente = []
  linhas.tratamento = novos.tratamento.map((t) => {
    problemas.conferir('tratamento', STATUS.tratamento.has(t.status), 'status não permitido')
    problemas.conferir('tratamento', textoOk(t.procedure), 'procedimento ausente')
    problemas.conferir('tratamento', dinheiroOk(t.value), 'valor fora do limite')
    problemas.conferir('tratamento', textoOk(t.date), 'data ausente')
    if (t.procedimentoSourceId !== null && t.procedimentoSourceId !== undefined) {
      const dono = convenioDoProcedimento.get(t.procedimentoSourceId)
      const doTratamento = t.convenioNome === null ? undefined : convenioPorNome.get(t.convenioNome)?.sourceId
      problemas.conferir('tratamento', dono !== undefined && dono === doTratamento, 'procedimento de outro convênio')
    }
    const id = ids.tratamento.get(t.sourceId)
    for (const d of t.dentes) {
      problemas.conferir('dente', inteiroOk(d.tooth_number), 'número inválido')
      linhas.dente.push({ id: randomUUID(), treatment_id: id, tooth_number: d.tooth_number, faces: d.faces })
    }
    return {
      id, clinic_id: clinicId, patient_id: ref('tratamento', 'paciente', t.pacienteSourceId), professional_id: professionalId,
      insurance_plan_id: planoDoNome(t.convenioNome), insurance_procedure_id: refOpcional('tratamento', 'procedimento', t.procedimentoSourceId),
      procedure: t.procedure, value: t.value, date: t.date, status: t.status, imported_from: t.imported_from,
      created_at: ouPadrao(t.created_at),
    }
  })

  linhas.evolucao = novos.evolucao.map((e) => {
    problemas.conferir('evolucao', textoOk(e.date), 'data ausente')
    return {
      id: ids.evolucao.get(e.sourceId), clinic_id: clinicId, patient_id: ref('evolucao', 'paciente', e.pacienteSourceId),
      professional_id: professionalId, date: e.date, description: e.description, created_at: ouPadrao(e.created_at),
    }
  })

  const inteiroOuNuloOk = (v) => v === null || inteiroOk(v)
  linhas.historico = novos.historico.map((h) => {
    problemas.conferir('historico', dinheiroOk(h.amount), 'valor fora do limite')
    problemas.conferir('historico', STATUS.historico.has(h.original_status), 'situação não permitida')
    problemas.conferir('historico', inteiroOuNuloOk(h.installment_number) && inteiroOuNuloOk(h.installment_count), 'parcela inválida')
    return {
      id: ids.historico.get(h.sourceId), clinic_id: clinicId, patient_id: ref('historico', 'paciente', h.pacienteSourceId),
      budget_id: refOpcional('historico', 'orcamento', h.orcamentoSourceId), source_id: h.sourceId, description: h.description,
      amount: h.amount, due_date: h.due_date, paid_at: h.paid_at, payment_method: h.payment_method,
      installment_number: h.installment_number, installment_count: h.installment_count, original_status: h.original_status,
    }
  })

  const paraVincular = {
    ...novos,
    convenio: [...resolvidos.convenio.novos, ...resolvidos.convenio.reaproveitados],
    procedimento: [...resolvidos.procedimento.novos, ...resolvidos.procedimento.reaproveitados],
  }
  linhas.vinculo = Object.keys(fontes).flatMap((entidade) => paraVincular[entidade].map((l) => ({
    clinic_id: clinicId, source: FONTE, entity: entidade, source_id: l.sourceId, target_id: ids[entidade].get(l.sourceId),
  })))

  return { linhas, novos }
}

// ── Gravação ───────────────────────────────────────────────────────────────
/**
 * @param cliente cliente `pg` já conectado
 * @param plano resultado de mapearBackup
 * @param opts { clinicId, professionalId, permitirExistentes?, permitirNovos? }
 */
export async function gravarPlano(cliente, plano, opts) {
  const { clinicId, professionalId, permitirExistentes = false, permitirNovos = false } = opts ?? {}
  if (!clinicId || !professionalId) throw new ErroGravacao('clinicId e professionalId são obrigatórios')

  const fontes = {
    convenio: plano.convenios, procedimento: plano.procedimentos, paciente: plano.pacientes, consulta: plano.consultas,
    orcamento: plano.orcamentos, item_orcamento: plano.orcamentos.flatMap((o) => o.itens), tratamento: plano.tratamentos,
    evolucao: plano.evolucoes, historico: plano.historico,
  }

  let etapa = 'verificação'
  try {
    await cliente.query('BEGIN')

    // Trava a clínica sem bloquear o uso normal: duas importações não rodam juntas.
    const clinica = await cliente.query('SELECT id FROM clinics WHERE id = $1 FOR NO KEY UPDATE', [clinicId])
    if (!clinica.rows.length) throw new ErroGravacao('Importação recusada. Clínica não encontrada.')
    const prof = await cliente.query('SELECT id FROM professionals WHERE id = $1 AND clinic_id = $2', [professionalId, clinicId])
    if (!prof.rows.length) throw new ErroGravacao('Importação recusada. Profissional não pertence à clínica.')

    const problemas = criarProblemas()
    conferirIdsUnicos(fontes, problemas)
    conferirConvenios(plano, problemas)
    conferirDonosDosOrcamentos(plano, problemas)
    problemas.lancar()

    const { rows: rowsVinculos } = await cliente.query(
      'SELECT entity, source_id, target_id FROM import_links WHERE clinic_id = $1 AND source = $2',
      [clinicId, FONTE],
    )
    const vinculos = indexarVinculos(rowsVinculos)
    const { rows: planosExistentes } = await cliente.query('SELECT id, name FROM insurance_plans WHERE clinic_id = $1', [clinicId])
    const { rows: procsExistentes } = await cliente.query(
      'SELECT id, insurance_plan_id, code FROM insurance_plan_procedures WHERE clinic_id = $1',
      [clinicId],
    )

    const ids = Object.fromEntries(Object.keys(fontes).map((e) => [e, new Map()]))
    const resolvidos = {
      convenio: resolverConvenios(plano, vinculos, planosExistentes, ids, problemas),
    }
    resolvidos.procedimento = resolverProcedimentos(plano, vinculos, procsExistentes, ids, problemas)
    await conferirOrcamentosVinculados(cliente, plano, vinculos, clinicId, problemas)
    problemas.lancar()

    if (!permitirExistentes) {
      const { rows } = await cliente.query(
        `SELECT count(*) AS n FROM patients p WHERE p.clinic_id = $1 AND NOT EXISTS (
           SELECT 1 FROM import_links l
           WHERE l.clinic_id = p.clinic_id AND l.source = $2 AND l.entity = 'paciente' AND l.target_id = p.id
         )`,
        [clinicId, FONTE],
      )
      const n = Number(rows[0].n)
      if (n !== 0) {
        throw new ErroGravacao(`Importação recusada. A clínica tem ${n} paciente(s) fora da importação. Use --permitir-existentes se isso for esperado.`)
      }
    }

    if (vinculos.total > 0 && !permitirNovos) {
      const faltam = (entidade) => fontes[entidade].filter((l) => !vinculos.de(entidade).has(l.sourceId)).length
      const consultas = faltam('consulta')
      const historico = faltam('historico')
      if (consultas + historico > 0) {
        throw new ErroGravacao(
          `Importação recusada. A clínica já foi importada e o plano traria ${consultas + historico} registro(s) novo(s) sem id estável `
          + `(consultas: ${consultas}, histórico: ${historico}). Use --permitir-novos se isso for esperado.`,
        )
      }
    }

    const { linhas, novos } = montarLinhas(plano, fontes, vinculos, ids, resolvidos, { clinicId, professionalId }, problemas)
    problemas.lancar()

    for (const entidade of ['convenio', 'procedimento', 'paciente', 'consulta']) {
      etapa = entidade
      await inserir(cliente, entidade, linhas[entidade])
    }

    etapa = 'orcamento'
    const temOrcamento = linhas.orcamento.length > 0 || linhas.item_orcamento.length > 0
    if (temOrcamento) await cliente.query("SELECT set_config('app.budget_system', 'on', true)")
    await inserir(cliente, 'orcamento', linhas.orcamento)
    etapa = 'item_orcamento'
    await inserir(cliente, 'item_orcamento', linhas.item_orcamento)
    if (temOrcamento) await cliente.query("SELECT set_config('app.budget_system', 'off', true)")

    for (const entidade of ['tratamento', 'dente', 'evolucao', 'historico', 'vinculo']) {
      etapa = entidade
      await inserir(cliente, entidade, linhas[entidade])
    }

    // Só na primeira importação: uma nova execução não desfaz o que a clínica escolheu depois.
    etapa = 'mensagem'
    const mensagens = vinculos.total === 0
      ? await cliente.query(
        'UPDATE message_settings SET enabled = false WHERE clinic_id = $1 AND type = ANY($2::text[]) AND enabled',
        [clinicId, ['recall', 'birthday']],
      )
      : { rowCount: 0 }

    etapa = 'commit'
    const fim = await cliente.query('COMMIT')
    if (fim?.command && fim.command !== 'COMMIT') {
      throw new ErroGravacao('A transação não foi confirmada pelo banco (COMMIT virou ROLLBACK). Nada foi gravado.')
    }

    const contar = (f) => Object.fromEntries(Object.keys(fontes).map((e) => [e, f(e)]))
    return {
      inseridos: contar((e) => linhas[e].length),
      reaproveitados: {
        convenio: resolvidos.convenio.reaproveitados.length,
        procedimento: resolvidos.procedimento.reaproveitados.length,
      },
      jaVinculados: contar((e) => (
        e === 'convenio' || e === 'procedimento'
          ? fontes[e].length - resolvidos[e].novos.length - resolvidos[e].reaproveitados.length
          : fontes[e].length - novos[e].length
      )),
      dentes: linhas.dente.length,
      vinculosCriados: linhas.vinculo.length,
      mensagensDesativadas: mensagens.rowCount ?? 0,
    }
  } catch (e) {
    try {
      await cliente.query('ROLLBACK')
    } catch {
      // Conexão perdida: o servidor desfaz a transação aberta.
    }
    throw erroSeguro(e, etapa)
  }
}
