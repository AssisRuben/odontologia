// Envio retomável dos arquivos do backup para o Storage.
// Caminhos e nomes do ZIP podem ter dados pessoais: logs, erros e resultados trazem só contagens.
// O nome original vai apenas em documents.name.
import { createHash } from 'node:crypto'
import { crc32 } from 'node:zlib'
import yauzl from 'yauzl'

export const BUCKET = 'anneOdonto'
const FONTE = 'codental'
const ENTIDADE = 'arquivo'
const MAX_CONCORRENCIA = 4
const MAX_REPETICOES = 3
const ESPERA_BASE_MS = 500
const MAX_TAMANHO = 50 * 1024 * 1024
const BYTES_ASSINATURA = 64
const MAX_IDS = 500

// Lista fixa de categorias da aba Documentos do paciente.
const CATEGORIAS = {
  arquivos: 'outros',
  documentos_personalizados: 'documento',
  receitas: 'documento',
  fotos_pacientes: 'foto',
  atestados: 'documento',
  anamneses: 'documento',
}

const MARCAS_HEIC = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs'])
const MARCAS_HEIF_GENERICAS = new Set(['mif1', 'msf1'])
const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export class ErroArquivos extends Error {
  constructor(mensagem) {
    super(mensagem)
    this.name = 'ErroArquivos'
  }
}

const codigoSeguro = (e) => (typeof e?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(e.code) ? e.code : 'sem código')
const temCategoria = (c) => Object.prototype.hasOwnProperty.call(CATEGORIAS, c)

// ── Tipo pelos bytes ───────────────────────────────────────────────────────
function ehHeic(b) {
  if (b.length < 16 || b.toString('latin1', 4, 8) !== 'ftyp') return false
  const tamanhoCaixa = b.readUInt32BE(0)
  if (tamanhoCaixa < 16) return false
  const principal = b.toString('latin1', 8, 12)
  if (MARCAS_HEIC.has(principal)) return true
  if (!MARCAS_HEIF_GENERICAS.has(principal)) return false
  const limite = Math.min(tamanhoCaixa, b.length)
  for (let i = 16; i + 4 <= limite; i += 4) {
    if (MARCAS_HEIC.has(b.toString('latin1', i, i + 4))) return true
  }
  return false
}

/** @returns {{ mime: string, ext: string } | null} */
export function detectarTipo(b) {
  if (b.length >= 8 && b.subarray(0, 8).equals(ASSINATURA_PNG)) return { mime: 'image/png', ext: 'png' }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' }
  if (b.length >= 5 && b.toString('latin1', 0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' }
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' }
  }
  if (ehHeic(b)) return { mime: 'image/heic', ext: 'heic' }
  return null
}

// ── Plano ──────────────────────────────────────────────────────────────────
/** Divide `<categoria>/<numero>/<arquivo>`; caminho inseguro devolve null. */
function partesSeguras(caminho) {
  if (typeof caminho !== 'string' || caminho.includes('\\') || caminho.startsWith('/')) return null
  if (/[\u0000-\u001f\u007f]/.test(caminho)) return null
  const partes = caminho.split('/')
  if (partes.length !== 3) return null
  if (partes.some((p) => p === '' || p === '.' || p === '..' || p.includes(':'))) return null
  return partes
}

/**
 * @param entradas [{ caminho, crc32, tamanho, abrir, inseguro? }]
 * @param pacientesPorNumero Map numero -> id do paciente
 */
export function planejarArquivos(entradas, pacientesPorNumero) {
  const caminhos = new Set()
  const grupos = new Set()
  return entradas.map((entrada) => {
    const base = {
      sourceId: createHash('sha256').update(entrada.caminho).digest('hex'),
      patientId: null, categoria: null, categoriaDesconhecida: false, nome: null, grupo: null,
      crc32: entrada.crc32, tamanho: entrada.tamanho, abrir: entrada.abrir,
    }
    const partes = entrada.inseguro ? null : partesSeguras(entrada.caminho)
    const repetido = caminhos.has(entrada.caminho)
    caminhos.add(entrada.caminho)
    if (!partes || repetido) return { ...base, estado: 'recusado' }

    const [pasta, numero, arquivo] = partes
    const conhecida = temCategoria(pasta)
    const item = {
      ...base,
      categoria: conhecida ? CATEGORIAS[pasta] : 'outros',
      categoriaDesconhecida: !conhecida,
      nome: arquivo.normalize('NFC'),
    }
    const patientId = pacientesPorNumero.get(numero)
    if (!patientId) return { ...item, estado: 'sem_paciente' }

    const grupo = `${patientId}|${entrada.crc32}|${entrada.tamanho}`
    const copia = grupos.has(grupo)
    grupos.add(grupo)
    return { ...item, patientId, grupo, estado: copia ? 'copia' : 'enviar' }
  })
}

export function resumirPlano(planejados) {
  const resumo = { total: planejados.length, porCategoria: {}, duplicados: 0, recusados: 0, semPaciente: 0, categoriaDesconhecida: 0 }
  for (const p of planejados) {
    if (p.estado === 'recusado') {
      resumo.recusados++
      continue
    }
    if (p.estado === 'sem_paciente') {
      resumo.semPaciente++
      continue
    }
    if (p.estado === 'copia') resumo.duplicados++
    if (p.categoriaDesconhecida) resumo.categoriaDesconhecida++
    resumo.porCategoria[p.categoria] = (resumo.porCategoria[p.categoria] ?? 0) + 1
  }
  return resumo
}

function agrupar(planejados) {
  const grupos = new Map()
  for (const p of planejados) {
    if (p.estado !== 'enviar' && p.estado !== 'copia') continue
    if (!grupos.has(p.grupo)) grupos.set(p.grupo, [])
    grupos.get(p.grupo).push(p)
  }
  return [...grupos.values()]
}

// ── Leitura ────────────────────────────────────────────────────────────────
async function lerInicio(item) {
  const partes = []
  let total = 0
  for await (const parte of await item.abrir()) {
    partes.push(parte)
    total += parte.length
    if (total >= BYTES_ASSINATURA) break
  }
  return Buffer.concat(partes).subarray(0, BYTES_ASSINATURA)
}

/** Lê um arquivo inteiro e confere tamanho e CRC, que o yauzl não valida. */
async function lerCompleto(item) {
  if (item.tamanho > MAX_TAMANHO) throw new ErroArquivos('arquivo acima do limite')
  const partes = []
  let total = 0
  let crc = 0
  for await (const parte of await item.abrir()) {
    total += parte.length
    if (total > item.tamanho) throw new ErroArquivos('tamanho divergente')
    crc = crc32(parte, crc)
    partes.push(parte)
  }
  if (total !== item.tamanho || crc !== item.crc32) throw new ErroArquivos('conteúdo divergente')
  return Buffer.concat(partes)
}

/** Conta tipos não reconhecidos sem rede. Cópias herdam o resultado do primeiro. */
export async function simularArquivos(planejados) {
  const resumo = { ...resumirPlano(planejados), tipoDesconhecido: 0, ilegiveis: 0 }
  for (const grupo of agrupar(planejados)) {
    try {
      if (!detectarTipo(await lerInicio(grupo[0]))) resumo.tipoDesconhecido += grupo.length
    } catch {
      resumo.ilegiveis += grupo.length
    }
  }
  return resumo
}

// ── ZIP ────────────────────────────────────────────────────────────────────
const erroZip = (e) => new ErroArquivos(`Não foi possível ler o ZIP (código: ${codigoSeguro(e)})`)

function ehLinkSimbolico(entry) {
  const criadoEmUnix = entry.versionMadeBy >>> 8 === 3
  return criadoEmUnix && ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000
}

/**
 * Lê só o diretório central; o conteúdo é aberto sob demanda.
 * decodeStrings: false impede o yauzl de abortar o ZIP inteiro num nome inválido
 * ou de trocar barra invertida: quem recusa é o plano, entrada por entrada.
 */
export async function lerEntradasZip(arquivo) {
  const zip = await new Promise((resolve, reject) => {
    yauzl.open(arquivo, { lazyEntries: true, autoClose: false, decodeStrings: false, validateEntrySizes: true }, (e, z) => {
      if (e) reject(erroZip(e))
      else resolve(z)
    })
  })
  const fechar = () => new Promise((resolve) => {
    if (!zip.isOpen) return resolve()
    zip.once('close', resolve)
    zip.close()
  })

  try {
    const entradas = await new Promise((resolve, reject) => {
      const lista = []
      zip.on('error', (e) => reject(erroZip(e)))
      zip.on('end', () => resolve(lista))
      zip.on('entry', (entry) => {
        const caminho = yauzl.getFileNameLowLevel(entry.generalPurposeBitFlag, entry.fileName, entry.extraFields, true)
        if (!caminho.endsWith('/')) {
          lista.push({
            caminho,
            crc32: entry.crc32,
            tamanho: entry.uncompressedSize,
            inseguro: ehLinkSimbolico(entry),
            abrir: () => new Promise((ok, falha) => {
              zip.openReadStream(entry, (e, s) => (e ? falha(erroZip(e)) : ok(s)))
            }),
          })
        }
        zip.readEntry()
      })
      zip.readEntry()
    })
    return { entradas, fechar }
  } catch (e) {
    await fechar()
    throw e
  }
}

// ── Banco ──────────────────────────────────────────────────────────────────
async function lerVinculos(cliente, clinicId, entidade) {
  const { rows } = await cliente.query(
    'SELECT source_id, target_id FROM import_links WHERE clinic_id = $1 AND source = $2 AND entity = $3',
    [clinicId, FONTE, entidade],
  )
  return new Map(rows.map((r) => [r.source_id, r.target_id]))
}

async function lerPorIds(cliente, sql, clinicId, ids) {
  const unicos = [...new Set(ids)]
  const linhas = []
  for (let i = 0; i < unicos.length; i += MAX_IDS) {
    const { rows } = await cliente.query(sql, [clinicId, unicos.slice(i, i + MAX_IDS)])
    linhas.push(...rows)
  }
  return linhas
}

/** Número -> sourceId; número vazio ou repetido fica de fora, para nunca ligar ao paciente errado. */
export function numerosUnicos(pacientes) {
  const contagem = new Map()
  for (const p of pacientes) if (p.numero) contagem.set(p.numero, (contagem.get(p.numero) ?? 0) + 1)
  const mapa = new Map()
  for (const p of pacientes) if (p.numero && contagem.get(p.numero) === 1) mapa.set(p.numero, p.sourceId)
  return mapa
}

/** Número -> id do paciente já importado e ainda existente na clínica. */
export async function pacientesVinculados(cliente, clinicId, pacientes) {
  const vinculos = await lerVinculos(cliente, clinicId, 'paciente')
  const candidatos = [...numerosUnicos(pacientes)]
    .filter(([, sourceId]) => vinculos.has(sourceId))
    .map(([numero, sourceId]) => [numero, vinculos.get(sourceId)])
  const existentes = new Set((await lerPorIds(
    cliente,
    'SELECT id FROM patients WHERE clinic_id = $1 AND id = ANY($2::uuid[])',
    clinicId,
    candidatos.map(([, id]) => id),
  )).map((r) => r.id))
  return new Map(candidatos.filter(([, id]) => existentes.has(id)))
}

/** Um único comando é uma transação: nunca fica documento sem vínculo, nem vínculo sem documento. */
const SQL_REGISTRAR = `WITH vinculo AS (
  INSERT INTO import_links (clinic_id, source, entity, source_id, target_id)
  VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::uuid)
  ON CONFLICT DO NOTHING
  RETURNING target_id
)
INSERT INTO documents (id, clinic_id, patient_id, name, file_url, file_type, size_bytes, category)
SELECT target_id, $1::uuid, $6::uuid, $7::text, $8::text, $9::text, $10::bigint, $11::text FROM vinculo`

const SQL_VINCULAR = `INSERT INTO import_links (clinic_id, source, entity, source_id, target_id)
VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::uuid)
ON CONFLICT DO NOTHING`

// ── Envio ──────────────────────────────────────────────────────────────────
/** UUID estável: repetir a execução reescreve o mesmo objeto e usa o mesmo documento. */
function idDeterministico(clinicId, sourceId) {
  const b = createHash('sha256').update(`${clinicId}\0${sourceId}`).digest().subarray(0, 16)
  b[6] = (b[6] & 0x0f) | 0x80
  b[8] = (b[8] & 0x3f) | 0x80
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** O Storage traz o HTTP em `status` e às vezes outro código em `statusCode`. */
function ehTransitorio(erro) {
  const codigos = [erro?.status, erro?.statusCode].map(Number).filter((n) => Number.isInteger(n) && n > 0)
  return !codigos.length || codigos.some((n) => n === 408 || n === 429 || n >= 500)
}

async function enviarComRepeticao(storage, esperar, caminho, corpo, opcoes) {
  for (let tentativa = 0; ; tentativa++) {
    let erro
    try {
      erro = (await storage.upload(caminho, corpo, opcoes))?.error ?? null
    } catch (e) {
      erro = e ?? new Error('falha')
    }
    if (!erro) return
    if (tentativa >= MAX_REPETICOES || !ehTransitorio(erro)) throw new ErroArquivos('falha no envio')
    await esperar(ESPERA_BASE_MS * 2 ** tentativa)
  }
}

const esperaPadrao = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * @param deps { cliente, storage: { upload(caminho, corpo, opcoes) }, esperar? }
 * @param planejados resultado de planejarArquivos
 * @param opts { clinicId, concorrencia? } no máximo 4 envios simultâneos
 */
export async function enviarArquivos(deps, planejados, opts) {
  const { cliente, storage, esperar = esperaPadrao } = deps
  const { clinicId, concorrencia = MAX_CONCORRENCIA } = opts
  const plano = resumirPlano(planejados)
  const motivos = { semPaciente: plano.semPaciente, tipoDesconhecido: 0, leitura: 0, envio: 0, banco: 0, vinculoDivergente: 0 }
  const r = { enviados: 0, copias: 0, jaRegistrados: 0 }

  const vinculos = await lerVinculos(cliente, clinicId, ENTIDADE)
  const alvos = planejados.map((p) => vinculos.get(p.sourceId)).filter(Boolean)
  const donos = new Map((await lerPorIds(
    cliente,
    'SELECT id, patient_id FROM documents WHERE clinic_id = $1 AND id = ANY($2::uuid[])',
    clinicId,
    alvos,
  )).map((d) => [d.id, d.patient_id]))

  const vincularCopia = async (item, alvo) => {
    try {
      const { rowCount } = await cliente.query(SQL_VINCULAR, [clinicId, FONTE, ENTIDADE, item.sourceId, alvo])
      if (rowCount === 0) r.jaRegistrados++
      else r.copias++
    } catch {
      motivos.banco++
    }
  }

  /** Envia o primeiro do grupo. Devolve { id } do documento ou { motivo } da falha. */
  const enviarOriginal = async (item) => {
    let motivo = 'leitura'
    try {
      const corpo = await lerCompleto(item)
      const tipo = detectarTipo(corpo)
      if (!tipo) {
        motivo = 'tipoDesconhecido'
        throw new ErroArquivos('tipo desconhecido')
      }
      const id = idDeterministico(clinicId, item.sourceId)
      const caminho = `${clinicId}/${item.patientId}/${id}.${tipo.ext}`
      motivo = 'envio'
      await enviarComRepeticao(storage, esperar, caminho, corpo, { contentType: tipo.mime, upsert: true })
      motivo = 'banco'
      const { rowCount } = await cliente.query(SQL_REGISTRAR, [
        clinicId, FONTE, ENTIDADE, item.sourceId, id, item.patientId, item.nome, caminho, tipo.mime, corpo.length, item.categoria,
      ])
      if (rowCount === 0) r.jaRegistrados++
      else r.enviados++
      return { id }
    } catch {
      return { motivo }
    }
  }

  const processarGrupo = async (grupo) => {
    let alvo = null
    const pendentes = []
    for (const item of grupo) {
      const ligado = vinculos.get(item.sourceId)
      if (!ligado) {
        pendentes.push(item)
      } else if (donos.has(ligado) && donos.get(ligado) !== item.patientId) {
        motivos.vinculoDivergente++
      } else {
        r.jaRegistrados++
        alvo ??= ligado
      }
    }
    if (!pendentes.length) return
    if (!alvo) {
      const original = pendentes.shift()
      const envio = await enviarOriginal(original)
      if (envio.motivo) {
        // As cópias têm os mesmos bytes: ficam pendentes para a próxima execução.
        motivos[envio.motivo] += 1 + pendentes.length
        return
      }
      alvo = envio.id
    }
    for (const copia of pendentes) await vincularCopia(copia, alvo)
  }

  const grupos = agrupar(planejados)
  const limite = Math.max(1, Math.min(MAX_CONCORRENCIA, concorrencia))
  let proximo = 0
  await Promise.all(Array.from({ length: Math.min(limite, grupos.length) }, async () => {
    while (proximo < grupos.length) await processarGrupo(grupos[proximo++])
  }))

  return {
    total: plano.total,
    ...r,
    recusados: plano.recusados,
    falhas: Object.values(motivos).reduce((a, b) => a + b, 0),
    motivos,
    porCategoria: plano.porCategoria,
    categoriaDesconhecida: plano.categoriaDesconhecida,
  }
}
