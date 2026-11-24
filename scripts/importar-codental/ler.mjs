// Lê as planilhas do backup do Codental e normaliza células.
// Erros citam planilha, coluna e linha, nunca o valor da célula (dados de paciente).

import { readdir } from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'

// Grafias como "liquído" e "carterinha" são do arquivo original.
export const COLUNAS = {
  pacientes: ['ID', 'Numero', 'Nome completo', 'Profissão', 'CPF', 'RG', 'Data de nascimento', 'Sexo', 'CEP', 'Endereço', 'Complemento', 'Bairro', 'Cidade', 'Estado', 'Email', 'Celular', 'Contato de emergência nome', 'Contato de emergência telefone', 'Telefone', 'Responsável nome', 'Responsável CPF', 'Responsável data de nascimento', 'Nome do plano', 'Numero da carterinha', 'CPF do titular', 'Observações', 'Anotações', 'Como conheceu', 'Data de criação', 'Última consulta'],
  consultas: ['Paciente', 'ID Paciente', 'Dentista', 'ID Dentista', 'Data consulta', 'Duração', 'Status', 'Celular', 'Etiquetas', 'Observação', 'Cadastrada por'],
  convenios: ['ID', 'Procedimento', 'Valor', 'Ativo', 'Categoria', 'Convênio', 'ID Convênio'],
  evolucoes: ['ID', 'Paciente', 'ID Paciente', 'CPF Paciente', 'Número Paciente', 'Dentista', 'Descrição', 'Data', 'Data de criação', 'Última atualização'],
  orcamentos: ['ID', 'Paciente', 'ID Paciente', 'CPF Paciente', 'Número Paciente', 'Orçamento', 'Valor da entrada', 'Desconto', 'Valor total', 'Parcelado?', 'Aprovado', 'Parcelas', 'Observações', 'Data de criação', 'Última atualização'],
  pagamentos: ['Paciente', 'ID Paciente', 'CPF Paciente', 'Número Paciente', 'Pagamento', 'Valor total', 'Valor liquído', 'Data de vencimento', 'Data de pagamento', 'Forma de pagamento', 'Parcela', 'Total de parcelas', 'Data de criação', 'Última atualização', 'ID orçamento', 'Tratamentos', 'Profissionais'],
  tratamentos: ['ID', 'Paciente', 'ID Paciente', 'CPF Paciente', 'Número Paciente', 'Dentista', 'Procedimento', 'Convênio', 'Finalizado', 'Dente', 'Faces', 'ID orçamento', 'Data de criação', 'Última atualização'],
  profissionais: ['ID', 'Usuário', 'Nome', 'CPF', 'CRO', 'UF CRO', 'Email', 'Telefone', 'Data de criação'],
}

export const erroCelula = ({ planilha, coluna, linha }, motivo) =>
  new Error(`Planilha ${planilha}, coluna ${coluna}, linha ${linha}: ${motivo}`)

// ── Leitura ────────────────────────────────────────────────────────────────
function valorCelula(v) {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v
  if (typeof v === 'string') return v.normalize('NFC').trim() || null
  if (typeof v !== 'object') return v
  if (Array.isArray(v.richText)) return valorCelula(v.richText.map((p) => p.text).join(''))
  if ('result' in v) return valorCelula(v.result)
  if ('text' in v) return valorCelula(v.text)
  return null
}

// O exceljs entrega { error } na célula, ou em `result` quando ela tem fórmula.
const celulaComErro = (v) =>
  v !== null && typeof v === 'object' && !(v instanceof Date) && ('error' in v || celulaComErro(v.result ?? null))

async function lerPlanilha(arquivo, planilha) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(arquivo)
  const ws = wb.worksheets[0]
  if (!ws) throw new Error(`Planilha ${planilha}: arquivo sem aba`)

  const posicao = new Map()
  ws.getRow(1).eachCell((celula, col) => {
    const nome = valorCelula(celula.value)
    if (typeof nome !== 'string') return
    if (posicao.has(nome) && COLUNAS[planilha].includes(nome)) {
      throw new Error(`Planilha ${planilha}: coluna ${nome} repetida`)
    }
    posicao.set(nome, col)
  })
  for (const coluna of COLUNAS[planilha]) {
    if (!posicao.has(coluna)) throw new Error(`Planilha ${planilha}: coluna obrigatória ausente: ${coluna}`)
  }

  const linhas = []
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === 1) return
    const obj = { _linha: n }
    let temValor = false
    for (const coluna of COLUNAS[planilha]) {
      const bruto = row.getCell(posicao.get(coluna)).value
      if (celulaComErro(bruto)) throw erroCelula({ planilha, coluna, linha: n }, 'célula com erro do Excel')
      const v = valorCelula(bruto)
      obj[coluna] = v
      if (v !== null) temValor = true
    }
    if (temValor) linhas.push(obj)
  })
  return linhas
}

/**
 * @param {string} pasta
 * @returns {Promise<Record<keyof typeof COLUNAS, Array<Record<string, any>>>>}
 */
export async function lerBackup(pasta) {
  const arquivos = new Map((await readdir(pasta)).map((a) => [a.toLowerCase(), a]))
  const backup = {}
  for (const planilha of Object.keys(COLUNAS)) {
    const arquivo = arquivos.get(`${planilha}.xlsx`)
    if (!arquivo) throw new Error(`Planilha ${planilha}: arquivo ausente no backup`)
    backup[planilha] = await lerPlanilha(path.join(pasta, arquivo), planilha)
  }
  return backup
}

// ── Normalização de células ────────────────────────────────────────────────
export function texto(v) {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString()
  return String(v).normalize('NFC').trim() || null
}

export function digitos(v) {
  const t = texto(v)
  return t ? t.replace(/\D/g, '') || null : null
}

const RE_DINHEIRO = /^(-)?\s*(?:R\$\s*)?(-)?\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/

export function dinheiro(v, onde) {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 100) / 100
  const m = typeof v === 'string' ? RE_DINHEIRO.exec(v.trim()) : null
  if (!m || (m[1] && m[2])) throw erroCelula(onde, 'valor em dinheiro inválido')
  const centavos = Number(m[3].replace(/\./g, '')) * 100 + Number((m[4] ?? '').padEnd(2, '0'))
  return (m[1] || m[2] ? -centavos : centavos) / 100
}

export function inteiroOuNulo(v, onde) {
  if (v === null || v === undefined || (typeof v === 'string' && /^\s*-+\s*$/.test(v))) return null
  if (typeof v === 'number' && Number.isInteger(v)) return v
  if (typeof v === 'string' && /^\s*\d+\s*$/.test(v)) return Number(v)
  throw erroCelula(onde, 'número inteiro inválido')
}

export function simNao(v, onde) {
  const t = texto(v)
  if (t === 'Sim') return true
  if (t === 'Não') return false
  throw erroCelula(onde, 'esperado Sim ou Não')
}

// ── Datas ──────────────────────────────────────────────────────────────────
// O relógio da planilha é o de São Paulo, tratado como -03:00 fixo.
const OFFSET_SP_HORAS = 3
const SEGUNDOS_DIA = 86400
const EPOCA_EXCEL_MS = Date.UTC(1899, 11, 30)

function partesDoUtc(d) {
  const s = new Date(Math.round(d.getTime() / 1000) * 1000)
  return {
    ano: s.getUTCFullYear(), mes: s.getUTCMonth() + 1, dia: s.getUTCDate(),
    hora: s.getUTCHours(), minuto: s.getUTCMinutes(), segundo: s.getUTCSeconds(),
  }
}

// Date do exceljs carrega o relógio da planilha nos campos UTC.
function partesData(v, onde) {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw erroCelula(onde, 'data inválida')
    return partesDoUtc(v)
  }
  if (typeof v === 'number') {
    // Antes do serial 61 o calendário do Excel difere (ano 1900 bissexto fictício).
    if (!Number.isFinite(v) || v < 61 || v >= 2958466) throw erroCelula(onde, 'data inválida')
    return partesDoUtc(new Date(EPOCA_EXCEL_MS + Math.round(v * SEGUNDOS_DIA) * 1000))
  }
  const m = typeof v === 'string'
    ? /^(\d{2})\/(\d{2})\/(\d{4})(?:\D+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(v.trim())
    : null
  if (!m) throw erroCelula(onde, 'data inválida')
  const [dia, mes, ano, hora, minuto, segundo] = [m[1], m[2], m[3], m[4] ?? 0, m[5] ?? 0, m[6] ?? 0].map(Number)
  const d = new Date(Date.UTC(ano, mes - 1, dia))
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia || hora > 23 || minuto > 59 || segundo > 59) {
    throw erroCelula(onde, 'data inválida')
  }
  return { ano, mes, dia, hora, minuto, segundo }
}

const dois = (n) => String(n).padStart(2, '0')

export function dataYmd(v, onde) {
  if (v === null || v === undefined) return null
  const p = partesData(v, onde)
  return `${String(p.ano).padStart(4, '0')}-${dois(p.mes)}-${dois(p.dia)}`
}

export function instanteSP(v, onde) {
  if (v === null || v === undefined) return null
  const p = partesData(v, onde)
  return new Date(Date.UTC(p.ano, p.mes - 1, p.dia, p.hora + OFFSET_SP_HORAS, p.minuto, p.segundo)).toISOString()
}
