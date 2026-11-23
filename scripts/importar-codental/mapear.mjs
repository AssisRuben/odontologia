// Converte o backup lido em um plano de importação. Função pura: não grava nada,
// e "agora" vem de opts. Erros citam planilha, coluna e linha, nunca valores.

import { dataYmd, digitos, dinheiro, erroCelula, inteiroOuNulo, instanteSP, simNao, texto } from './ler.mjs'

const ORIGEM = 'codental'
const SEM_DESFECHO = 'sem desfecho registrado no Codental'
const PARTICULAR = 'Particular'
const MAX_CODIGO = 20

const STATUS_CONSULTA = {
  Finalizada: 'completed',
  Faltou: 'no_show',
  'Cancelada pelo paciente': 'cancelled',
  'Cancelada pelo dentista': 'cancelled',
  Agendada: 'scheduled',
  Confirmada: 'confirmed',
}
const FORMAS = { Crédito: 'cartao_credito', Débito: 'cartao_debito', Dinheiro: 'dinheiro', Pix: 'pix' }
const GENEROS = { Masculino: 'M', Feminino: 'F', Outro: 'O' }
// Chaves do odontograma: O = Oclusal/Incisal, L = Lingual/Palatino.
const FACES = { V: 'V', M: 'M', D: 'D', O: 'O', L: 'L', 'O/I': 'O', 'L/P': 'L' }
// Dentes do odontograma (FDI): permanentes 11-18 a 41-48, decíduos 51-55 a 81-85.
const RE_DENTE_FDI = /^(?:[1-4][1-8]|[5-8][1-5])$/

// ── Auxiliares ─────────────────────────────────────────────────────────────
const onde = (planilha, linha, coluna) => ({ planilha, coluna, linha: linha._linha })
const juntar = (partes) => partes.filter(Boolean).join('\n') || null
const rotulo = (nome, v) => (v ? `${nome}: ${v}` : null)
const ausente = (t) => t === null || /^-+$/.test(t)
const semConvenio = (nome) => nome === null || nome === PARTICULAR

function obrigatorio(planilha, linha, coluna, ler = texto) {
  const local = onde(planilha, linha, coluna)
  const v = ler(linha[coluna], local)
  if (v === null) throw erroCelula(local, 'valor obrigatório ausente')
  return v
}

function idUnico(vistos, planilha, linha) {
  const id = obrigatorio(planilha, linha, 'ID')
  if (vistos.has(id)) throw erroCelula(onde(planilha, linha, 'ID'), 'identificador repetido')
  vistos.add(id)
  return id
}

// Parte estável do sourceId; não depende do fuso da máquina.
const chave = (v) => (v === null || v === undefined ? '' : texto(v) ?? '')

function contadorOcorrencias() {
  const n = new Map()
  return (k) => {
    const atual = n.get(k) ?? 0
    n.set(k, atual + 1)
    return `${k}|${atual}`
  }
}

function referencias(pacientes, orcamentos) {
  const paciente = (planilha, linha) => {
    const id = obrigatorio(planilha, linha, 'ID Paciente')
    if (!pacientes.has(id)) throw erroCelula(onde(planilha, linha, 'ID Paciente'), 'paciente inexistente')
    return id
  }
  const orcamento = (planilha, linha) => {
    const id = texto(linha['ID orçamento'])
    if (ausente(id)) return null
    if (!orcamentos.has(id)) throw erroCelula(onde(planilha, linha, 'ID orçamento'), 'orçamento inexistente')
    return id
  }
  return { paciente, orcamento }
}

// ── Tabela de preços ───────────────────────────────────────────────────────
function mapearConvenios(linhas) {
  const P = 'convenios'
  const convenios = new Map()
  const procedimentos = []
  const tabela = new Map()
  const vistos = new Set()

  for (const l of linhas) {
    const sourceId = idUnico(vistos, P, l)
    const nome = texto(l['Convênio'])
    if (nome === null) continue

    const procedimento = obrigatorio(P, l, 'Procedimento')
    const price = obrigatorio(P, l, 'Valor', dinheiro)
    if (price < 0) throw erroCelula(onde(P, l, 'Valor'), 'valor negativo')
    const active = simNao(l.Ativo, onde(P, l, 'Ativo'))

    if (nome !== PARTICULAR) {
      if (sourceId.length > MAX_CODIGO) throw erroCelula(onde(P, l, 'ID'), `identificador acima de ${MAX_CODIGO} caracteres`)
      const convenioSourceId = obrigatorio(P, l, 'ID Convênio')
      const existente = convenios.get(convenioSourceId)
      if (existente && existente.name !== nome) {
        throw erroCelula(onde(P, l, 'Convênio'), 'mesmo ID de convênio com outro nome')
      }
      if (!existente) convenios.set(convenioSourceId, { sourceId: convenioSourceId, name: nome })
      procedimentos.push({
        sourceId, code: sourceId, convenioSourceId, name: procedimento, price, active, category: texto(l.Categoria),
      })
    }

    if (!tabela.has(nome)) tabela.set(nome, new Map())
    const porNome = tabela.get(nome)
    if (!porNome.has(procedimento)) porNome.set(procedimento, { ativas: [], inativas: [] })
    porNome.get(procedimento)[active ? 'ativas' : 'inativas'].push({ sourceId, price })
  }
  return { convenios: [...convenios.values()], procedimentos, tabela }
}

// Só ativas; sem ativas, as inativas. Preços conflitantes não têm valor.
function precoDe(tabela, convenio, procedimento) {
  const grupo = convenio === null ? null : tabela.get(convenio)?.get(procedimento)
  if (!grupo) return null
  const conjunto = grupo.ativas.length ? grupo.ativas : grupo.inativas
  if (new Set(conjunto.map((c) => c.price)).size !== 1) return null
  return {
    value: conjunto[0].price,
    procedimentoSourceId: convenio === PARTICULAR ? null : conjunto[0].sourceId,
  }
}

// ── Pacientes ──────────────────────────────────────────────────────────────
function mapearPaciente(l, sourceId) {
  const P = 'pacientes'
  const sexo = texto(l.Sexo)
  if (sexo !== null && !Object.hasOwn(GENEROS, sexo)) throw erroCelula(onde(P, l, 'Sexo'), 'valor desconhecido')

  const address = {
    street: texto(l['Endereço']), complement: texto(l.Complemento), neighborhood: texto(l.Bairro),
    city: texto(l.Cidade), state: texto(l.Estado), zip: texto(l.CEP),
  }
  const plano = texto(l['Nome do plano'])
  const celular = digitos(l.Celular)
  const emergencia = [texto(l['Contato de emergência nome']), texto(l['Contato de emergência telefone'])]
    .filter(Boolean).join(' - ')
  const nascResp = dataYmd(l['Responsável data de nascimento'], onde(P, l, 'Responsável data de nascimento'))

  return {
    sourceId,
    numero: texto(l.Numero),
    name: obrigatorio(P, l, 'Nome completo'),
    cpf: digitos(l.CPF),
    phone: digitos(l.Telefone) ?? celular,
    whatsapp: celular,
    email: texto(l.Email),
    birthdate: dataYmd(l['Data de nascimento'], onde(P, l, 'Data de nascimento')),
    gender: sexo === null ? null : GENEROS[sexo],
    address: Object.values(address).some(Boolean) ? address : null,
    convenioNome: semConvenio(plano) ? null : plano,
    insurance_card: texto(l['Numero da carterinha']),
    notes: juntar([
      texto(l['Observações']),
      texto(l['Anotações']),
      rotulo('Profissão', texto(l['Profissão'])),
      rotulo('RG', texto(l.RG)),
      rotulo('Contato de emergência', emergencia),
      rotulo('Nascimento do responsável', nascResp && nascResp.split('-').reverse().join('/')),
      rotulo('CPF do titular', texto(l['CPF do titular'])),
      rotulo('Como conheceu', texto(l['Como conheceu'])),
    ]),
    payer_name: texto(l['Responsável nome']),
    payer_cpf: digitos(l['Responsável CPF']),
    created_at: instanteSP(l['Data de criação'], onde(P, l, 'Data de criação')),
    imported_from: ORIGEM,
  }
}

// ── Consultas ──────────────────────────────────────────────────────────────
function duracaoMinutos(l) {
  const local = onde('consultas', l, 'Duração')
  const v = l['Duração']
  const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) throw erroCelula(local, 'duração inválida')
  return n
}

function mapearConsultas(linhas, refs, agora, avisos) {
  const P = 'consultas'
  const proximoId = contadorOcorrencias()
  return linhas.map((l) => {
    const pacienteSourceId = refs.paciente(P, l)
    const rotuloStatus = texto(l.Status)
    if (!Object.hasOwn(STATUS_CONSULTA, rotuloStatus ?? '')) throw erroCelula(onde(P, l, 'Status'), 'status desconhecido')

    const start_time = obrigatorio(P, l, 'Data consulta', instanteSP)
    const inicio = new Date(start_time).getTime()
    const passada = inicio <= agora.getTime()
    let status = STATUS_CONSULTA[rotuloStatus]
    let nota = status === 'cancelled' ? rotuloStatus : null
    if (passada && (status === 'scheduled' || status === 'confirmed')) {
      status = 'cancelled'
      nota = SEM_DESFECHO
      avisos.consultasSemDesfecho++
    }
    return {
      sourceId: proximoId(`${pacienteSourceId}|${chave(l['Data consulta'])}`),
      pacienteSourceId,
      start_time,
      end_time: new Date(inicio + duracaoMinutos(l) * 60000).toISOString(),
      status,
      notes: juntar([nota, texto(l['Observação']), rotulo('Etiquetas', texto(l.Etiquetas))]),
      imported_from: passada ? ORIGEM : null,
    }
  })
}

// ── Evoluções ──────────────────────────────────────────────────────────────
function mapearEvolucoes(linhas, refs, avisos) {
  const P = 'evolucoes'
  const vistos = new Set()
  const conteudos = new Set()
  return linhas.map((l) => {
    const pacienteSourceId = refs.paciente(P, l)
    const evolucao = {
      sourceId: idUnico(vistos, P, l),
      pacienteSourceId,
      date: obrigatorio(P, l, 'Data', dataYmd),
      description: texto(l['Descrição']),
      created_at: instanteSP(l['Data de criação'], onde(P, l, 'Data de criação')),
    }
    const k = JSON.stringify([pacienteSourceId, evolucao.date, evolucao.description])
    if (conteudos.has(k)) avisos.evolucoesRepetidas++
    conteudos.add(k)
    return evolucao
  })
}

// ── Tratamentos ────────────────────────────────────────────────────────────
function lerDentes(l) {
  const P = 'tratamentos'
  const bruto = texto(l.Dente)
  if (ausente(bruto)) return []
  const numeros = [...new Set(bruto.split(',').map((d) => d.trim()))]
  if (numeros.some((d) => !RE_DENTE_FDI.test(d))) throw erroCelula(onde(P, l, 'Dente'), 'dente inválido')

  const brutoFaces = texto(l.Faces)
  const faces = ausente(brutoFaces) ? [] : brutoFaces.split(',').map((f) => {
    const face = f.trim()
    if (!Object.hasOwn(FACES, face)) throw erroCelula(onde(P, l, 'Faces'), 'face desconhecida')
    return FACES[face]
  })
  return numeros.map((d) => ({ tooth_number: Number(d), faces: [...new Set(faces)] }))
}

function mapearTratamentos(linhas, refs, tabela, avisos) {
  const P = 'tratamentos'
  const vistos = new Set()
  return linhas.map((l) => {
    const pacienteSourceId = refs.paciente(P, l)
    const sourceId = idUnico(vistos, P, l)
    const procedure = obrigatorio(P, l, 'Procedimento')
    const convenio = texto(l['Convênio'])
    const preco = precoDe(tabela, convenio, procedure)
    if (!preco) avisos.tratamentosSemValor++
    const finalizado = simNao(l.Finalizado, onde(P, l, 'Finalizado'))
    return {
      sourceId,
      pacienteSourceId,
      orcamentoSourceId: refs.orcamento(P, l),
      procedure,
      value: preco?.value ?? 0,
      date: obrigatorio(P, l, 'Data de criação', dataYmd),
      status: finalizado ? 'completed' : 'planned',
      convenioNome: semConvenio(convenio) ? null : convenio,
      procedimentoSourceId: preco?.procedimentoSourceId ?? null,
      dentes: lerDentes(l),
      created_at: instanteSP(l['Data de criação'], onde(P, l, 'Data de criação')),
      imported_from: finalizado ? ORIGEM : null,
    }
  })
}

// ── Orçamentos ─────────────────────────────────────────────────────────────
// Valor informado de fato: ignora vazio, traço e zero.
function informado(v) {
  const t = texto(v)
  if (ausente(t) || /^(R\$\s*)?0+([.,]0+)?%?$/.test(t)) return null
  return t
}

function mapearOrcamentos(linhas, refs, tratamentos) {
  const P = 'orcamentos'
  const itensPorOrcamento = new Map()
  for (const t of tratamentos) {
    if (!t.orcamentoSourceId) continue
    const tooth = t.dentes.map((d) => d.tooth_number).join(', ') || null
    if (!itensPorOrcamento.has(t.orcamentoSourceId)) itensPorOrcamento.set(t.orcamentoSourceId, [])
    itensPorOrcamento.get(t.orcamentoSourceId).push({
      sourceId: t.sourceId, procedure: t.procedure, tooth, quantity: 1, unit_price: t.value,
    })
  }

  return linhas.map((l) => {
    const sourceId = texto(l.ID)
    const aprovado = simNao(l.Aprovado, onde(P, l, 'Aprovado'))
    const total = obrigatorio(P, l, 'Valor total', dinheiro)
    return {
      sourceId,
      pacienteSourceId: refs.paciente(P, l),
      status: aprovado ? 'approved' : 'draft',
      total,
      approved_total: aprovado ? total : null,
      notes: juntar([
        texto(l['Orçamento']),
        texto(l['Observações']),
        rotulo('Desconto', informado(l.Desconto)),
        rotulo('Entrada', informado(l['Valor da entrada'])),
        rotulo('Parcelas', informado(l.Parcelas)),
      ]),
      created_at: instanteSP(l['Data de criação'], onde(P, l, 'Data de criação')),
      imported_from: ORIGEM,
      itens: (itensPorOrcamento.get(sourceId) ?? []).map((i) => ({ ...i, approved: aprovado ? true : null })),
    }
  })
}

// ── Histórico financeiro ───────────────────────────────────────────────────
function mapearHistorico(linhas, refs, avisos) {
  const P = 'pagamentos'
  const proximoId = contadorOcorrencias()
  return linhas.map((l) => {
    const pacienteSourceId = refs.paciente(P, l)
    const orcamentoSourceId = refs.orcamento(P, l)
    const forma = texto(l['Forma de pagamento'])
    if (forma !== null && !Object.hasOwn(FORMAS, forma)) {
      throw erroCelula(onde(P, l, 'Forma de pagamento'), 'forma desconhecida')
    }
    const due_date = dataYmd(l['Data de vencimento'], onde(P, l, 'Data de vencimento'))
    const paid_at = dataYmd(l['Data de pagamento'], onde(P, l, 'Data de pagamento'))
    if (due_date && paid_at && paid_at.slice(0, 4) < due_date.slice(0, 4)) avisos.pagamentoAntesDoVencimentoAno++
    const k = [pacienteSourceId, chave(l['ID orçamento']), chave(l['Data de vencimento']), chave(l.Pagamento), chave(l.Parcela)]
    return {
      sourceId: proximoId(k.join('|')),
      pacienteSourceId,
      orcamentoSourceId,
      description: texto(l.Pagamento),
      amount: obrigatorio(P, l, 'Valor total', dinheiro),
      due_date,
      paid_at,
      payment_method: forma === null ? null : FORMAS[forma],
      installment_number: inteiroOuNulo(l.Parcela, onde(P, l, 'Parcela')),
      installment_count: inteiroOuNulo(l['Total de parcelas'], onde(P, l, 'Total de parcelas')),
      original_status: paid_at ? 'paid' : 'open',
    }
  })
}

// ── Avisos de cadastro ─────────────────────────────────────────────────────
function contarRepetidos(chaves) {
  const n = new Map()
  for (const k of chaves) n.set(k, (n.get(k) ?? 0) + 1)
  return [...n.values()].filter((c) => c > 1).length
}

const nomeComparavel = (nome) => nome.normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ')

// ── Plano ──────────────────────────────────────────────────────────────────
export function mapearBackup(backup, opts) {
  const { agora } = opts
  if (!(agora instanceof Date) || Number.isNaN(agora.getTime())) throw new Error('opts.agora inválido')

  const avisos = {
    tratamentosSemValor: 0, consultasSemDesfecho: 0, evolucoesRepetidas: 0,
    gruposNomeNascimento: 0, telefonesCompartilhados: 0, pagamentoAntesDoVencimentoAno: 0,
  }

  const idsPacientes = new Set()
  const pacientes = backup.pacientes.map((l) => mapearPaciente(l, idUnico(idsPacientes, 'pacientes', l)))
  const idsOrcamentos = new Set()
  for (const l of backup.orcamentos) idUnico(idsOrcamentos, 'orcamentos', l)
  const refs = referencias(idsPacientes, idsOrcamentos)

  const { convenios, procedimentos, tabela } = mapearConvenios(backup.convenios)
  const consultas = mapearConsultas(backup.consultas, refs, agora, avisos)
  const evolucoes = mapearEvolucoes(backup.evolucoes, refs, avisos)
  const tratamentos = mapearTratamentos(backup.tratamentos, refs, tabela, avisos)
  const orcamentos = mapearOrcamentos(backup.orcamentos, refs, tratamentos)
  const historico = mapearHistorico(backup.pagamentos, refs, avisos)

  avisos.gruposNomeNascimento = contarRepetidos(
    pacientes.filter((p) => p.birthdate).map((p) => `${nomeComparavel(p.name)}|${p.birthdate}`),
  )
  // Mesmo critério do app para achar o paciente pelo número: WhatsApp, senão telefone.
  avisos.telefonesCompartilhados = contarRepetidos(
    pacientes.map((p) => p.whatsapp ?? p.phone).filter(Boolean),
  )

  return { pacientes, convenios, procedimentos, consultas, evolucoes, tratamentos, orcamentos, historico, avisos }
}
