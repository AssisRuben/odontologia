// Gera uma cópia anonimizada das planilhas para a homologação. Não abre rede nem banco.
// Substitutos são sorteados a cada execução e nunca derivam do valor original.
// Os mapas original → substituto só existem em memória e nunca são gravados.

import { randomInt } from 'node:crypto'
import { readdir, rm, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { COLUNAS, dataYmd, digitos, texto } from './ler.mjs'
import { montarRelatorio } from './relatorio.mjs'

const DIA_MS = 86400000
const SERIAL_EPOCA_UNIX = 25569
const NASCIMENTO_MIN = Date.UTC(1930, 0, 1) / DIA_MS
const NASCIMENTO_MAX = Date.UTC(2010, 11, 31) / DIA_MS
const MIN_CONTADOR = 999_999
const COLUNAS_POR_LINHA = Math.max(...Object.values(COLUNAS).map((c) => c.length))
const LIMITE_RNG = 2 ** 48

const rngPadrao = () => randomInt(LIMITE_RNG) / LIMITE_RNG

export class ErroAnonimizacao extends Error {
  constructor(mensagem) {
    super(mensagem)
    this.name = 'ErroAnonimizacao'
  }
}

// ── Sorteio ────────────────────────────────────────────────────────────────
/** Inteiro em [0, n) do gerador injetado. */
function sortearCom(rng) {
  return (n) => {
    const x = rng()
    if (typeof x !== 'number' || !(x >= 0 && x < 1)) throw new ErroAnonimizacao('Gerador aleatório fora do intervalo [0, 1)')
    return Math.floor(x * n)
  }
}

/** Valores de [0, tamanho) sem repetição, em ordem embaralhada (Fisher-Yates esparso). */
function semRepeticao(sortear, tamanho) {
  const trocas = new Map()
  let restantes = tamanho
  return () => {
    if (restantes === 0) throw new ErroAnonimizacao('Faixa de substitutos esgotada')
    const i = sortear(restantes)
    const escolhido = trocas.get(i) ?? i
    restantes--
    trocas.set(i, trocas.get(restantes) ?? restantes)
    trocas.delete(restantes)
    return escolhido
  }
}

/** Mesmo original (pela chave), mesmo substituto. */
function substituidor(gerar) {
  const mapa = new Map()
  return (chave) => {
    if (!mapa.has(chave)) mapa.set(chave, gerar())
    return mapa.get(chave)
  }
}

const seis = (n) => String(n).padStart(6, '0')
const chaveNome = (nome) => nome.toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ')

// ── Formatos dos substitutos ───────────────────────────────────────────────
function digitoCpf(d, tamanho) {
  let soma = 0
  for (let i = 0; i < tamanho; i++) soma += d[i] * (tamanho + 1 - i)
  const resto = (soma * 10) % 11
  return resto === 10 ? 0 : resto
}

/** Base de 9 dígitos com o primeiro verificador deliberadamente errado: nunca é um CPF real. */
function cpfInvalido(base) {
  const nove = String(base).padStart(9, '0')
  const correto = digitoCpf(nove.split('').map(Number), 9)
  return `${nove}${(correto + 1) % 10}0`
}

function criarContexto(backup, rng) {
  const sortear = sortearCom(rng)
  const linhas = Object.keys(COLUNAS).reduce((s, p) => s + (backup[p]?.length ?? 0), 0)
  const capacidade = Math.max(MIN_CONTADOR, linhas * COLUNAS_POR_LINHA)
  const contador = () => {
    const proximo = semRepeticao(sortear, capacidade)
    return () => proximo() + 1
  }

  const numeroPaciente = contador()
  const numeroTexto = contador()
  const numeroEmail = contador()
  const numeroProfissional = contador()
  const baseCpf = semRepeticao(sortear, 1e9)
  const baseFone = semRepeticao(sortear, 1e8)
  const baseCartao = semRepeticao(sortear, 1e9)

  const profPorId = new Map()
  const profPorNome = new Map()

  const ctx = {
    sortear,
    paciente: substituidor(() => `Paciente ${seis(numeroPaciente())}`),
    cpf: substituidor(() => cpfInvalido(baseCpf())),
    fone: substituidor(() => `109${String(baseFone()).padStart(8, '0')}`),
    email: substituidor(() => `${seis(numeroEmail())}@example.invalid`),
    cartao: substituidor(() => `00000${String(baseCartao()).padStart(9, '0')}`),
    texto: substituidor(() => `Texto fictício ${seis(numeroTexto())}`),
    /** Mesmo ID, mesmo número; sem ID conhecido, o nome decide. */
    profissional(id, nome) {
      const k = nome === null ? null : chaveNome(nome)
      const n = (id !== null ? profPorId.get(id) : undefined) ?? (k !== null ? profPorNome.get(k) : undefined) ?? numeroProfissional()
      if (id !== null) profPorId.set(id, n)
      if (k !== null && !profPorNome.has(k)) profPorNome.set(k, n)
      return n
    },
  }

  // Homônimos com IDs diferentes continuam sendo profissionais diferentes.
  for (const l of backup.profissionais ?? []) {
    const id = texto(l.ID)
    const nome = texto(l.Nome)
    if (id !== null && !profPorId.has(id)) {
      const n = numeroProfissional()
      profPorId.set(id, n)
      if (nome !== null && !profPorNome.has(chaveNome(nome))) profPorNome.set(chaveNome(nome), n)
    }
  }
  return ctx
}

// ── Regras por tipo de coluna ──────────────────────────────────────────────
const manter = Symbol('manter')
const limpar = () => null
const fixo = (valor) => () => valor

const regraNome = (v, ctx, l, planilha) => {
  const id = texto(planilha === 'pacientes' ? l.ID : l['ID Paciente'])
  return ctx.paciente(id !== null ? `id:${id}` : `nome:${texto(v)}`)
}

// CPF numérico perde o zero à esquerda na planilha.
const regraCpf = (v, ctx) => {
  const d = digitos(v)
  return d === null ? null : ctx.cpf(d.padStart(11, '0'))
}

// A chave é a mesma do mapeador, para manter os grupos de telefone compartilhado.
const regraFone = (v, ctx) => {
  const d = digitos(v)
  return d === null ? null : ctx.fone(d)
}

const regraEmail = (v, ctx) => ctx.email(texto(v).toLocaleLowerCase('pt-BR'))

const regraCartao = (v, ctx) => {
  const t = texto(v)
  return ctx.cartao(t.replace(/[^0-9A-Za-z]/g, '').toUpperCase() || t)
}

const regraTexto = (v, ctx) => ctx.texto(texto(v))
const regraJson = (v, ctx) => JSON.stringify([ctx.texto(texto(v))])

function regraNascimento(v, ctx, l, planilha, coluna) {
  const original = dataYmd(v, { planilha, coluna, linha: l._linha })
  let dias = NASCIMENTO_MIN + ctx.sortear(NASCIMENTO_MAX - NASCIMENTO_MIN + 1)
  if (new Date(dias * DIA_MS).toISOString().slice(0, 10) === original) {
    dias += dias === NASCIMENTO_MAX ? -1 : 1
  }
  if (typeof v === 'number') return dias + SERIAL_EPOCA_UNIX
  const data = new Date(dias * DIA_MS)
  if (v instanceof Date) return data
  const [ano, mes, dia] = data.toISOString().slice(0, 10).split('-')
  return `${dia}/${mes}/${ano}`
}

const regraDentista = (v, ctx, l) => `Profissional ${ctx.profissional(texto(l['ID Dentista']), texto(v))}`
const regraNomeProfissional = (v, ctx, l) => `Profissional ${ctx.profissional(texto(l.ID), texto(v))}`
const regraUsuario = (v, ctx, l) => `profissional_${ctx.profissional(texto(l.ID), texto(l.Nome) ?? texto(v))}`

const NOME_PACIENTE = { Paciente: regraNome, 'ID Paciente': manter, 'CPF Paciente': regraCpf, 'Número Paciente': manter }

// Toda coluna do contrato tem regra: coluna nova sem regra interrompe a execução.
const REGRAS = {
  pacientes: {
    ID: manter, Numero: manter, 'Nome completo': regraNome, 'Profissão': fixo('Profissão fictícia'), CPF: regraCpf,
    RG: fixo('RG fictício'), 'Data de nascimento': regraNascimento, Sexo: manter, CEP: fixo('00000-000'),
    'Endereço': fixo('Rua Fictícia'), Complemento: fixo('Complemento fictício'), Bairro: fixo('Bairro Fictício'),
    Cidade: fixo('Cidade Fictícia'), Estado: fixo('ZZ'), Email: regraEmail, Celular: regraFone,
    'Contato de emergência nome': fixo('Contato fictício'), 'Contato de emergência telefone': regraFone, Telefone: regraFone,
    'Responsável nome': fixo('Responsável fictício'), 'Responsável CPF': regraCpf,
    'Responsável data de nascimento': regraNascimento, 'Nome do plano': manter, 'Numero da carterinha': regraCartao,
    'CPF do titular': regraCpf, 'Observações': regraTexto, 'Anotações': regraTexto, 'Como conheceu': fixo('Origem fictícia'),
    'Data de criação': manter, 'Última consulta': manter,
  },
  consultas: {
    Paciente: regraNome, 'ID Paciente': manter, Dentista: regraDentista, 'ID Dentista': manter, 'Data consulta': manter,
    'Duração': manter, Status: manter, Celular: regraFone, Etiquetas: regraTexto, 'Observação': regraTexto,
    'Cadastrada por': fixo('Usuário fictício'),
  },
  convenios: { ID: manter, Procedimento: manter, Valor: manter, Ativo: manter, Categoria: manter, 'Convênio': manter, 'ID Convênio': manter },
  evolucoes: {
    ID: manter, ...NOME_PACIENTE, Dentista: regraDentista, 'Descrição': regraTexto, Data: manter,
    'Data de criação': manter, 'Última atualização': manter,
  },
  orcamentos: {
    ID: manter, ...NOME_PACIENTE, 'Orçamento': regraTexto, 'Valor da entrada': manter, Desconto: manter, 'Valor total': manter,
    'Parcelado?': manter, Aprovado: manter, Parcelas: manter, 'Observações': regraTexto, 'Data de criação': manter,
    'Última atualização': manter,
  },
  pagamentos: {
    ...NOME_PACIENTE, Pagamento: regraTexto, 'Valor total': manter, 'Valor liquído': manter, 'Data de vencimento': manter,
    'Data de pagamento': manter, 'Forma de pagamento': manter, Parcela: manter, 'Total de parcelas': manter,
    'Data de criação': manter, 'Última atualização': manter, 'ID orçamento': manter, Tratamentos: regraJson,
    Profissionais: regraDentista,
  },
  tratamentos: {
    ID: manter, ...NOME_PACIENTE, Dentista: regraDentista, Procedimento: manter, 'Convênio': manter, Finalizado: manter,
    Dente: manter, Faces: manter, 'ID orçamento': manter, 'Data de criação': manter, 'Última atualização': manter,
  },
  profissionais: {
    ID: manter, 'Usuário': regraUsuario, Nome: regraNomeProfissional, CPF: limpar, CRO: limpar, 'UF CRO': limpar,
    Email: regraEmail, Telefone: limpar, 'Data de criação': manter,
  },
}

const vazio = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')

/**
 * Só as colunas do contrato saem daqui; colunas extras do arquivo são descartadas.
 * @param {Record<string, Array<Record<string, any>>>} backup
 * @param {{ rng?: () => number }} [opts] gerador em [0, 1), injetável nos testes
 * @returns {Record<string, Array<Record<string, any>>>}
 */
export function anonimizarBackup(backup, { rng = rngPadrao } = {}) {
  const ctx = criarContexto(backup, rng)
  /** @type {Record<string, Array<Record<string, any>>>} */
  const saida = {}
  for (const [planilha, colunas] of Object.entries(COLUNAS)) {
    const regras = REGRAS[planilha]
    saida[planilha] = (backup[planilha] ?? []).map((l) => {
      const nova = { _linha: l._linha }
      for (const coluna of colunas) {
        const regra = regras[coluna]
        if (!regra) throw new ErroAnonimizacao(`Planilha ${planilha}: coluna sem regra de anonimização: ${coluna}`)
        const v = l[coluna]
        if (regra === manter) nova[coluna] = v ?? null
        else nova[coluna] = vazio(v) ? null : regra(v, ctx, l, planilha, coluna)
      }
      return nova
    })
  }
  return saida
}

// ── Pasta de saída ─────────────────────────────────────────────────────────
/** Recusa antes de ler o backup; a mensagem nunca cita o caminho. */
export async function conferirSaidaVazia(pasta) {
  let itens
  try {
    itens = await readdir(pasta)
  } catch (e) {
    if (e?.code === 'ENOENT') return
    throw new ErroAnonimizacao('--saida precisa ser uma pasta vazia')
  }
  if (itens.length) throw new ErroAnonimizacao('--saida precisa ser uma pasta vazia')
}

async function gravarPlanilhas(backup, pasta, escritos) {
  await mkdir(pasta, { recursive: true })
  for (const [planilha, colunas] of Object.entries(COLUNAS)) {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Planilha')
    ws.addRow(colunas)
    for (const l of backup[planilha]) ws.addRow(colunas.map((c) => l[c] ?? null))
    const destino = path.join(pasta, `${planilha}.xlsx`)
    const conteudo = Buffer.from(await wb.xlsx.writeBuffer())
    // wx: nunca sobrescreve, mesmo se a pasta mudar depois da conferência.
    try {
      await writeFile(destino, conteudo, { flag: 'wx' })
    } catch (e) {
      // Escrita parcial é nossa e sai na limpeza; arquivo que já existia não é.
      if (e?.code !== 'EEXIST') escritos.push(destino)
      throw e
    }
    escritos.push(destino)
  }
}

// Nomes únicos por paciente desfazem de propósito os grupos de homônimos.
function estrutura(plano) {
  const r = montarRelatorio(plano)
  const avisos = { ...r.avisos }
  delete avisos.gruposNomeNascimento
  return JSON.stringify({ ...r, avisos })
}

const codigoSeguro = (e) => (typeof e?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(e.code) ? e.code : 'sem código')

/** Lê, anonimiza, grava e confere a ida e volta. Se a conferência falhar, não deixa planilhas. */
export async function anonimizarPasta({ backup, saida, agora, rng, ler, mapear, out }) {
  const escritos = []
  try {
    await conferirSaidaVazia(saida)
    const original = await ler(backup)
    const esperado = estrutura(mapear(original, { agora }))
    const anonimo = anonimizarBackup(original, rng ? { rng } : {})
    await gravarPlanilhas(anonimo, saida, escritos)
    const relido = await ler(saida)
    if (estrutura(mapear(relido, { agora })) !== esperado) {
      throw new ErroAnonimizacao('Conferência falhou: a cópia anonimizada não bate com o relatório original. Nada foi mantido.')
    }
    out([
      'Anonimização concluída (nenhuma conexão foi aberta)',
      'Linhas por planilha:',
      ...Object.keys(COLUNAS).map((p) => `  ${p}: ${anonimo[p].length}`),
      'Os ZIPs de arquivos de pacientes NÃO são anonimizados e nunca devem ir para a homologação.',
    ].join('\n'))
    return 0
  } catch (e) {
    await Promise.all(escritos.map((f) => rm(f, { force: true }).catch(() => {})))
    if (e instanceof ErroAnonimizacao || /^Planilha /.test(e?.message ?? '')) throw e
    throw new ErroAnonimizacao(`Falha na anonimização (código: ${codigoSeguro(e)})`)
  }
}
