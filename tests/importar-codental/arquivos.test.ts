import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { crc32, deflateRawSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import {
  detectarTipo,
  enviarArquivos,
  lerEntradasZip,
  pacientesVinculados,
  planejarArquivos,
  simularArquivos,
} from '../../scripts/importar-codental/arquivos.mjs'
import { principal } from '../../scripts/importar-codental/cli.mjs'

const CLINICA = '11111111-1111-4111-8111-111111111111'
const PROF = '22222222-2222-4222-8222-222222222222'
const PAC_A = '33333333-3333-4333-8333-333333333333'
const PAC_B = '44444444-4444-4444-8444-444444444444'
const NOME_SIGILOSO = 'Fulano Sigiloso exame.png'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('conteudo png')])
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('conteudo jpeg')])
const PDF = Buffer.from('%PDF-1.7 conteudo')
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 0, 0, 0]), Buffer.from('WEBPVP8 ')])
const heif = (marca: string, compat: string[] = []) => {
  const corpo = Buffer.concat([Buffer.from(marca), Buffer.alloc(4), ...compat.map((c) => Buffer.from(c))])
  const caixa = Buffer.alloc(8)
  caixa.writeUInt32BE(corpo.length + 8, 0)
  caixa.write('ftyp', 4)
  return Buffer.concat([caixa, corpo])
}
const DESCONHECIDO = Buffer.from('apenas texto comum')

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

type EntradaTeste = { caminho: string; crc32: number; tamanho: number; abrir: () => Promise<Readable>; inseguro?: boolean }

const entrada = (caminho: string, corpo: Buffer, extra: Partial<EntradaTeste> = {}): EntradaTeste => ({
  caminho,
  crc32: crc32(corpo),
  tamanho: corpo.length,
  abrir: async () => Readable.from([corpo]),
  ...extra,
})

const pacientes = () => new Map([['10', PAC_A], ['20', PAC_B]])

type Link = { entity: string; source_id: string; target_id: string }
type Doc = { id: string; patient_id: string }

class BancoFalso {
  links: Link[] = []
  docs: (Doc & Record<string, unknown>)[] = []
  sqls: string[] = []
  falharRegistroEm = new Set<string>()

  async query(sql: string, params: unknown[] = []) {
    this.sqls.push(sql)
    if (/^WITH vinculo/.test(sql)) {
      const [clinicId, , , sourceId, id, patientId, name, fileUrl, fileType, size, category] = params as string[]
      if (this.falharRegistroEm.has(sourceId)) throw Object.assign(new Error(`falha com ${NOME_SIGILOSO}`), { code: '23503' })
      if (this.links.some((l) => l.entity === 'arquivo' && l.source_id === sourceId)) return { rows: [], rowCount: 0 }
      this.links.push({ entity: 'arquivo', source_id: sourceId, target_id: id })
      this.docs.push({ id, clinic_id: clinicId, patient_id: patientId, name, file_url: fileUrl, file_type: fileType, size_bytes: size, category })
      return { rows: [], rowCount: 1 }
    }
    if (/^INSERT INTO import_links/.test(sql)) {
      const [, , , sourceId, targetId] = params as string[]
      if (this.links.some((l) => l.entity === 'arquivo' && l.source_id === sourceId)) return { rows: [], rowCount: 0 }
      this.links.push({ entity: 'arquivo', source_id: sourceId, target_id: targetId })
      return { rows: [], rowCount: 1 }
    }
    if (/FROM import_links/.test(sql)) {
      const entidade = params[2]
      return { rows: this.links.filter((l) => l.entity === entidade) }
    }
    if (/FROM documents/.test(sql)) return { rows: this.docs.filter((d) => (params[1] as string[]).includes(d.id)) }
    if (/FROM patients/.test(sql)) return { rows: (params[1] as string[]).filter((id) => id !== 'apagado').map((id) => ({ id })) }
    if (/FROM clinics/.test(sql)) return { rows: [{ id: CLINICA }] }
    return { rows: [], rowCount: 0 }
  }
}

type Envio = { caminho: string; corpo: Buffer; opcoes: { contentType: string; upsert: boolean } }

class StorageFalso {
  envios: Envio[] = []
  ativos = 0
  maxAtivos = 0
  erros: unknown[] = []
  atraso = 0

  async upload(caminho: string, corpo: Buffer, opcoes: Envio['opcoes']) {
    this.ativos++
    this.maxAtivos = Math.max(this.maxAtivos, this.ativos)
    await new Promise((r) => setTimeout(r, this.atraso))
    this.ativos--
    this.envios.push({ caminho, corpo, opcoes })
    const erro = this.erros.shift()
    if (erro instanceof Error) throw erro
    return { error: erro ?? null }
  }
}

const preparar = () => {
  const cliente = new BancoFalso()
  const storage = new StorageFalso()
  const esperas: number[] = []
  const deps = { cliente, storage, esperar: async (ms: number) => { esperas.push(ms) } }
  return { cliente, storage, deps, esperas }
}
const opts = { clinicId: CLINICA }

describe('planejarArquivos', () => {
  it('liga <categoria>/<numero>/<arquivo> ao paciente e mapeia a categoria', () => {
    const [p] = planejarArquivos([entrada('fotos_pacientes/10/a.png', PNG)], pacientes())
    expect(p).toMatchObject({ estado: 'enviar', patientId: PAC_A, categoria: 'foto', nome: 'a.png', sourceId: sha('fotos_pacientes/10/a.png') })
  })

  it.each([
    ['arquivos', 'outros'], ['documentos_personalizados', 'documento'], ['receitas', 'documento'],
    ['fotos_pacientes', 'foto'], ['atestados', 'documento'], ['anamneses', 'documento'],
  ])('categoria %s vira %s', (origem, destino) => {
    const [p] = planejarArquivos([entrada(`${origem}/10/a.png`, PNG)], pacientes())
    expect(p.categoria).toBe(destino)
    expect(p.categoriaDesconhecida).toBe(false)
  })

  it('categoria desconhecida vira outros e fica marcada', () => {
    const [p] = planejarArquivos([entrada('nova_pasta/10/a.png', PNG)], pacientes())
    expect(p).toMatchObject({ categoria: 'outros', categoriaDesconhecida: true, estado: 'enviar' })
  })

  it.each([
    '../10/a.png', 'arquivos/../a.png', 'arquivos/10/..', '/arquivos/10/a.png', 'C:/10/a.png',
    'arquivos\\10\\a.png', 'arquivos/10/a\\b.png', 'arquivos/10', 'arquivos/10/sub/a.png', 'arquivos//a.png', 'arquivos/./a.png',
  ])('recusa caminho inseguro %s', (caminho) => {
    const [p] = planejarArquivos([entrada(caminho, PNG)], pacientes())
    expect(p.estado).toBe('recusado')
    expect(p.patientId).toBeNull()
  })

  it('recusa entrada marcada como insegura e caminho repetido', () => {
    const r = planejarArquivos([
      entrada('arquivos/10/link.png', PNG, { inseguro: true }),
      entrada('arquivos/10/a.png', PNG),
      entrada('arquivos/10/a.png', JPEG),
    ], pacientes())
    expect(r.map((p: { estado: string }) => p.estado)).toEqual(['recusado', 'enviar', 'recusado'])
  })

  it('número sem paciente fica sem_paciente', () => {
    const [p] = planejarArquivos([entrada('arquivos/99/a.png', PNG)], pacientes())
    expect(p.estado).toBe('sem_paciente')
  })

  it('cópia exige mesmo paciente, CRC e tamanho', () => {
    const r = planejarArquivos([
      entrada('arquivos/10/a.png', PNG),
      entrada('receitas/10/b.png', PNG),
      entrada('arquivos/20/a.png', PNG),
      entrada('arquivos/10/c.png', PNG, { tamanho: PNG.length + 1 }),
    ], pacientes())
    expect(r.map((p: { estado: string }) => p.estado)).toEqual(['enviar', 'copia', 'enviar', 'enviar'])
    expect(r[1].grupo).toBe(r[0].grupo)
    expect(r[2].grupo).not.toBe(r[0].grupo)
  })
})

describe('detectarTipo', () => {
  it.each([
    [PNG, 'image/png', 'png'], [JPEG, 'image/jpeg', 'jpg'], [PDF, 'application/pdf', 'pdf'], [WEBP, 'image/webp', 'webp'],
    [heif('heic'), 'image/heic', 'heic'], [heif('mif1', ['heic']), 'image/heic', 'heic'],
  ])('reconhece pelos bytes', (bytes, mime, ext) => {
    expect(detectarTipo(bytes)).toEqual({ mime, ext })
  })

  it.each([[DESCONHECIDO], [Buffer.alloc(0)], [heif('mif1', ['avif'])], [heif('isom')]])('não reconhece outros', (bytes) => {
    expect(detectarTipo(bytes)).toBeNull()
  })
})

describe('enviarArquivos', () => {
  it('envia para caminho determinístico sem o nome original e registra o documento', async () => {
    const { cliente, storage, deps } = preparar()
    const zip = 'fotos_pacientes/10/Fulano Sigiloso.png'
    const r = await enviarArquivos(deps, planejarArquivos([entrada(zip, PNG)], pacientes()), opts)
    expect(r).toMatchObject({ enviados: 1, falhas: 0 })
    const { caminho, opcoes } = storage.envios[0]
    expect(caminho).toMatch(new RegExp(`^${CLINICA}/${PAC_A}/[0-9a-f-]{36}\\.png$`))
    expect(caminho).not.toContain('Fulano')
    expect(opcoes).toEqual({ contentType: 'image/png', upsert: true })
    expect(cliente.docs[0]).toMatchObject({
      clinic_id: CLINICA, patient_id: PAC_A, name: 'Fulano Sigiloso.png', file_url: caminho, file_type: 'image/png', size_bytes: PNG.length, category: 'foto',
    })
    expect(cliente.links[0]).toEqual({ entity: 'arquivo', source_id: sha(zip), target_id: cliente.docs[0].id })
  })

  it('sem extensão recebe o tipo pelos bytes (PNG)', async () => {
    const { cliente, storage, deps } = preparar()
    await enviarArquivos(deps, planejarArquivos([entrada('arquivos/10/semextensao', PNG)], pacientes()), opts)
    expect(storage.envios[0].caminho.endsWith('.png')).toBe(true)
    expect(cliente.docs[0]).toMatchObject({ file_type: 'image/png', name: 'semextensao' })
  })

  it('confia nos bytes quando a extensão contradiz', async () => {
    const { cliente, storage, deps } = preparar()
    await enviarArquivos(deps, planejarArquivos([entrada('arquivos/10/falso.pdf', JPEG)], pacientes()), opts)
    expect(storage.envios[0].caminho.endsWith('.jpg')).toBe(true)
    expect(cliente.docs[0].file_type).toBe('image/jpeg')
  })

  it('cópia idêntica reaproveita o envio e o documento', async () => {
    const { cliente, storage, deps } = preparar()
    const r = await enviarArquivos(deps, planejarArquivos([
      entrada('arquivos/10/a.png', PNG), entrada('receitas/10/b.png', PNG),
    ], pacientes()), opts)
    expect(r).toMatchObject({ enviados: 1, copias: 1, falhas: 0 })
    expect(storage.envios).toHaveLength(1)
    expect(cliente.docs).toHaveLength(1)
    expect(cliente.links.map((l) => l.target_id)).toEqual([cliente.docs[0].id, cliente.docs[0].id])
  })

  it('arquivo já registrado em import_links é pulado', async () => {
    const { cliente, storage, deps } = preparar()
    const planejados = planejarArquivos([entrada('arquivos/10/a.png', PNG)], pacientes())
    await enviarArquivos(deps, planejados, opts)
    const r = await enviarArquivos(deps, planejados, opts)
    expect(r).toMatchObject({ enviados: 0, jaRegistrados: 1, falhas: 0 })
    expect(storage.envios).toHaveLength(1)
    expect(cliente.docs).toHaveLength(1)
  })

  it('cópia nova de arquivo já registrado só ganha o vínculo', async () => {
    const { cliente, storage, deps } = preparar()
    await enviarArquivos(deps, planejarArquivos([entrada('arquivos/10/a.png', PNG)], pacientes()), opts)
    const r = await enviarArquivos(deps, planejarArquivos([
      entrada('arquivos/10/a.png', PNG), entrada('receitas/10/b.png', PNG),
    ], pacientes()), opts)
    expect(r).toMatchObject({ enviados: 0, copias: 1, jaRegistrados: 1 })
    expect(storage.envios).toHaveLength(1)
    expect(cliente.docs).toHaveLength(1)
    expect(cliente.links).toHaveLength(2)
  })

  it('vínculo cujo documento é de outro paciente conta como falha e não é reaproveitado', async () => {
    const { cliente, storage, deps } = preparar()
    const planejados = planejarArquivos([entrada('arquivos/10/a.png', PNG), entrada('receitas/10/b.png', PNG)], pacientes())
    const alvo = '55555555-5555-4555-8555-555555555555'
    cliente.links.push({ entity: 'arquivo', source_id: planejados[0].sourceId, target_id: alvo })
    cliente.docs.push({ id: alvo, patient_id: PAC_B })
    const r = await enviarArquivos(deps, planejados, opts)
    expect(r.motivos.vinculoDivergente).toBe(1)
    expect(r.falhas).toBeGreaterThanOrEqual(1)
    expect(cliente.links.filter((l) => l.target_id === alvo)).toHaveLength(1)
    expect(storage.envios.every((e) => e.caminho.includes(PAC_A))).toBe(true)
  })

  it('falha em um arquivo não para os demais e entra no relatório', async () => {
    const { cliente, storage, deps } = preparar()
    storage.erros = [{ statusCode: '403', message: `negado ${NOME_SIGILOSO}` }]
    const r = await enviarArquivos(deps, planejarArquivos([
      entrada('arquivos/10/a.png', PNG), entrada('arquivos/10/b.pdf', PDF), entrada('arquivos/20/c.jpg', JPEG),
    ], pacientes()), { ...opts, concorrencia: 1 })
    expect(r).toMatchObject({ enviados: 2, falhas: 1 })
    expect(r.motivos.envio).toBe(1)
    expect(cliente.docs).toHaveLength(2)
    expect(JSON.stringify(r)).not.toContain('Sigiloso')
  })

  it('falha do original marca as cópias como falha, sem vínculo', async () => {
    const { cliente, storage, deps } = preparar()
    storage.erros = [{ statusCode: '403', message: 'negado' }]
    const r = await enviarArquivos(deps, planejarArquivos([
      entrada('arquivos/10/a.png', PNG), entrada('receitas/10/b.png', PNG),
    ], pacientes()), opts)
    expect(r).toMatchObject({ enviados: 0, copias: 0, falhas: 2 })
    expect(cliente.links).toHaveLength(0)
  })

  it('repete erro transitório até 3 vezes com espera', async () => {
    const { storage, deps, esperas } = preparar()
    storage.erros = [{ statusCode: '503' }, new Error('rede'), { status: 429 }]
    const r = await enviarArquivos(deps, planejarArquivos([entrada('arquivos/10/a.png', PNG)], pacientes()), opts)
    expect(r).toMatchObject({ enviados: 1, falhas: 0 })
    expect(storage.envios).toHaveLength(4)
    expect(esperas).toHaveLength(3)
  })

  it('desiste depois de 3 novas tentativas', async () => {
    const { cliente, storage, deps } = preparar()
    storage.erros = Array.from({ length: 10 }, () => ({ statusCode: '500' }))
    const r = await enviarArquivos(deps, planejarArquivos([entrada('arquivos/10/a.png', PNG)], pacientes()), opts)
    expect(r.falhas).toBe(1)
    expect(storage.envios).toHaveLength(4)
    expect(cliente.docs).toHaveLength(0)
  })

  it('não repete erro definitivo', async () => {
    const { storage, deps } = preparar()
    storage.erros = [{ statusCode: '413' }]
    await enviarArquivos(deps, planejarArquivos([entrada('arquivos/10/a.png', PNG)], pacientes()), opts)
    expect(storage.envios).toHaveLength(1)
  })

  it('retoma depois de queda entre envio e registro, no mesmo caminho', async () => {
    const { cliente, storage, deps } = preparar()
    const planejados = planejarArquivos([entrada('arquivos/10/a.png', PNG)], pacientes())
    cliente.falharRegistroEm.add(planejados[0].sourceId)
    const r1 = await enviarArquivos(deps, planejados, opts)
    expect(r1.motivos.banco).toBe(1)
    expect(cliente.docs).toHaveLength(0)
    cliente.falharRegistroEm.clear()
    const r2 = await enviarArquivos(deps, planejados, opts)
    expect(r2.enviados).toBe(1)
    expect(storage.envios).toHaveLength(2)
    expect(storage.envios[1].caminho).toBe(storage.envios[0].caminho)
    expect(storage.envios[1].opcoes.upsert).toBe(true)
    expect(cliente.docs).toHaveLength(1)
  })

  it('não grava documento se o envio falhou', async () => {
    const { cliente, storage, deps } = preparar()
    storage.erros = [{ statusCode: '400' }]
    await enviarArquivos(deps, planejarArquivos([entrada('arquivos/10/a.png', PNG)], pacientes()), opts)
    expect(cliente.docs).toHaveLength(0)
    expect(cliente.links).toHaveLength(0)
  })

  it('tipo desconhecido é falha e não é enviado', async () => {
    const { storage, deps } = preparar()
    const r = await enviarArquivos(deps, planejarArquivos([entrada('arquivos/10/a.png', DESCONHECIDO)], pacientes()), opts)
    expect(r.motivos.tipoDesconhecido).toBe(1)
    expect(r.falhas).toBe(1)
    expect(storage.envios).toHaveLength(0)
  })

  it('sem paciente é falha, recusado é contado à parte, nada é enviado', async () => {
    const { storage, deps } = preparar()
    const r = await enviarArquivos(deps, planejarArquivos([
      entrada('arquivos/99/a.png', PNG), entrada('../10/b.png', PNG),
    ], pacientes()), opts)
    expect(r).toMatchObject({ falhas: 1, recusados: 1 })
    expect(r.motivos.semPaciente).toBe(1)
    expect(storage.envios).toHaveLength(0)
  })

  it('bytes que não conferem com o CRC não são enviados', async () => {
    const { storage, deps } = preparar()
    const r = await enviarArquivos(deps, planejarArquivos([entrada('arquivos/10/a.png', PNG, { crc32: 1 })], pacientes()), opts)
    expect(r.motivos.leitura).toBe(1)
    expect(storage.envios).toHaveLength(0)
  })

  it('leitura com erro conta como falha sem vazar a mensagem', async () => {
    const { deps } = preparar()
    const r = await enviarArquivos(deps, planejarArquivos([entrada('arquivos/10/a.png', PNG, {
      abrir: async () => { throw new Error(`falha em ${NOME_SIGILOSO}`) },
    })], pacientes()), opts)
    expect(r.motivos.leitura).toBe(1)
    expect(JSON.stringify(r)).not.toContain('Sigiloso')
  })

  it('envia no máximo 4 por vez, mesmo pedindo mais', async () => {
    const { storage, deps } = preparar()
    storage.atraso = 5
    const entradas = Array.from({ length: 12 }, (_, i) => {
      const corpo = Buffer.concat([PNG, Buffer.from([i])])
      return entrada(`arquivos/10/${i}.png`, corpo)
    })
    const r = await enviarArquivos(deps, planejarArquivos(entradas, pacientes()), { ...opts, concorrencia: 20 })
    expect(r.enviados).toBe(12)
    expect(storage.maxAtivos).toBeLessThanOrEqual(4)
    expect(storage.maxAtivos).toBeGreaterThan(1)
  })
})

// ── ZIP real, pequeno e fictício ─────────────────────────────────────────────
type ItemZip = { nome: string; corpo: Buffer; comprimir?: boolean; modo?: number }

function montarZip(itens: ItemZip[]) {
  const locais: Buffer[] = []
  const centrais: Buffer[] = []
  let deslocamento = 0
  for (const { nome, corpo, comprimir, modo } of itens) {
    const nomeBuf = Buffer.from(nome, 'utf8')
    const dados = comprimir ? deflateRawSync(corpo) : corpo
    const metodo = comprimir ? 8 : 0
    const crc = crc32(corpo)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt16LE(metodo, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(dados.length, 18)
    local.writeUInt32LE(corpo.length, 22)
    local.writeUInt16LE(nomeBuf.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x031e, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x800, 8)
    central.writeUInt16LE(metodo, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(dados.length, 20)
    central.writeUInt32LE(corpo.length, 24)
    central.writeUInt16LE(nomeBuf.length, 28)
    central.writeUInt32LE(((modo ?? 0o100644) << 16) >>> 0, 38)
    central.writeUInt32LE(deslocamento, 42)
    locais.push(local, nomeBuf, dados)
    centrais.push(central, nomeBuf)
    deslocamento += local.length + nomeBuf.length + dados.length
  }
  const dir = Buffer.concat(centrais)
  const fim = Buffer.alloc(22)
  fim.writeUInt32LE(0x06054b50, 0)
  fim.writeUInt16LE(itens.length, 8)
  fim.writeUInt16LE(itens.length, 10)
  fim.writeUInt32LE(dir.length, 12)
  fim.writeUInt32LE(deslocamento, 16)
  return Buffer.concat([...locais, dir, fim])
}

const lerTudo = async (s: Readable) => {
  const partes: Buffer[] = []
  for await (const p of s) partes.push(p as Buffer)
  return Buffer.concat(partes)
}

describe('lerEntradasZip', () => {
  const limpar: string[] = []
  afterEach(async () => { while (limpar.length) await rm(limpar.pop()!, { recursive: true, force: true }) })
  const gravarZip = async (itens: ItemZip[]) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'imp-zip-'))
    limpar.push(dir)
    const arq = path.join(dir, 'a.zip')
    await writeFile(arq, montarZip(itens))
    return arq
  }

  it('lista entradas, ignora pastas e abre em streaming (com e sem compressão)', async () => {
    const grande = Buffer.concat([PNG, Buffer.alloc(100000, 7)])
    const arq = await gravarZip([
      { nome: 'arquivos/', corpo: Buffer.alloc(0) },
      { nome: 'arquivos/10/ação.png', corpo: grande, comprimir: true },
      { nome: 'receitas/10/b.pdf', corpo: PDF },
    ])
    const zip = await lerEntradasZip(arq)
    try {
      expect(zip.entradas.map((e: EntradaTeste) => e.caminho)).toEqual(['arquivos/10/ação.png', 'receitas/10/b.pdf'])
      expect(zip.entradas[0].tamanho).toBe(grande.length)
      expect(zip.entradas[0].crc32).toBe(crc32(grande))
      expect((await lerTudo(await zip.entradas[0].abrir())).equals(grande)).toBe(true)
      expect((await lerTudo(await zip.entradas[1].abrir())).equals(PDF)).toBe(true)
    } finally {
      await zip.fechar()
    }
  })

  it('não aborta com nomes perigosos: mantém para o plano recusar', async () => {
    const arq = await gravarZip([
      { nome: '../fora.png', corpo: PNG },
      { nome: 'arquivos\\10\\a.png', corpo: PNG },
      { nome: '/abs/10/a.png', corpo: PNG },
      { nome: 'arquivos/10/ok.png', corpo: PNG },
    ])
    const zip = await lerEntradasZip(arq)
    try {
      const estados = planejarArquivos(zip.entradas, pacientes()).map((p: { estado: string }) => p.estado)
      expect(estados).toEqual(['recusado', 'recusado', 'recusado', 'enviar'])
    } finally {
      await zip.fechar()
    }
  })

  it('marca link simbólico como inseguro', async () => {
    const arq = await gravarZip([{ nome: 'arquivos/10/link.png', corpo: PNG, modo: 0o120777 }])
    const zip = await lerEntradasZip(arq)
    try {
      expect(zip.entradas[0].inseguro).toBe(true)
    } finally {
      await zip.fechar()
    }
  })

  it('simulação lê só o início de entrada grande e o ZIP fecha sem travar', async () => {
    const grande = Buffer.concat([PNG, randomBytes(300000)])
    const arq = await gravarZip([
      { nome: 'arquivos/10/grande.png', corpo: grande, comprimir: true },
      { nome: 'arquivos/10/grande2.png', corpo: Buffer.concat([DESCONHECIDO, randomBytes(300000)]) },
    ])
    const zip = await lerEntradasZip(arq)
    const r = await simularArquivos(planejarArquivos(zip.entradas, pacientes()))
    await zip.fechar()
    expect(r).toMatchObject({ total: 2, tipoDesconhecido: 1, ilegiveis: 0 })
  })

  it('erro ao abrir não cita o caminho', async () => {
    await expect(lerEntradasZip(path.join(os.tmpdir(), 'Fulano-Sigiloso-inexistente.zip'))).rejects.toThrow(/^(?!.*Sigiloso)/)
  })
})

describe('pacientesVinculados', () => {
  it('liga número ao paciente vinculado e descarta número ambíguo ou paciente apagado', async () => {
    const cliente = new BancoFalso()
    cliente.links = [
      { entity: 'paciente', source_id: 'S1', target_id: PAC_A },
      { entity: 'paciente', source_id: 'S2', target_id: PAC_B },
      { entity: 'paciente', source_id: 'S3', target_id: 'apagado' },
      { entity: 'paciente', source_id: 'S4', target_id: PAC_A },
      { entity: 'paciente', source_id: 'S5', target_id: PAC_B },
    ]
    const mapa = await pacientesVinculados(cliente, CLINICA, [
      { sourceId: 'S1', numero: '10' },
      { sourceId: 'S3', numero: '30' },
      { sourceId: 'S4', numero: '40' },
      { sourceId: 'S5', numero: '40' },
      { sourceId: 'S6', numero: '60' },
      { sourceId: 'S2', numero: null },
    ])
    expect([...mapa]).toEqual([['10', PAC_A]])
  })
})

describe('cli --arquivos', () => {
  const limpar: string[] = []
  afterEach(async () => { while (limpar.length) await rm(limpar.pop()!, { recursive: true, force: true }) })
  const SEGREDO_BANCO = 'senhasecreta'
  const SEGREDO_CHAVE = 'chave-service-role-secreta'
  const ENV = {
    IMPORT_DATABASE_URL: `postgresql://usuario:${SEGREDO_BANCO}@db.exemplo.test:5432/postgres`,
    IMPORT_SUPABASE_URL: 'https://projeto.exemplo.test',
    IMPORT_SUPABASE_SERVICE_ROLE_KEY: SEGREDO_CHAVE,
  }

  const rodar = async (extra: string[], over: Record<string, unknown> = {}, itens?: ItemZip[]) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'imp-cli-'))
    limpar.push(dir)
    const zipPath = path.join(dir, 'arquivos.zip')
    await writeFile(zipPath, montarZip(itens ?? [
      { nome: `fotos_pacientes/10/${NOME_SIGILOSO}`, corpo: PNG, comprimir: true },
      { nome: 'receitas/10/copia.png', corpo: PNG },
      { nome: 'arquivos/10/texto.txt', corpo: DESCONHECIDO },
      { nome: '../fora.png', corpo: JPEG },
      { nome: 'arquivos/99/sem.png', corpo: PDF },
    ]))
    const saida = path.join(dir, 'saida')
    const out: string[] = []
    const err: string[] = []
    const banco = new BancoFalso()
    banco.links = [{ entity: 'paciente', source_id: 'S1', target_id: PAC_A }]
    const storage = new StorageFalso()
    const estado = { conectou: 0, fechou: 0, storage: 0, cfgStorage: null as unknown, gravou: 0 }
    const codigo = await principal(
      ['--backup', 'pasta', '--clinica', CLINICA, '--profissional', PROF, '--saida', saida, '--arquivos', zipPath, ...extra],
      {
        lerBackup: async () => ({}),
        mapearBackup: () => ({ pacientes: [{ sourceId: 'S1', numero: '10' }] }),
        out: (s: string) => out.push(s),
        err: (s: string) => err.push(s),
        env: ENV,
        criarCliente: () => {
          estado.conectou++
          return Object.assign(banco, {
            connect: async () => {},
            end: async () => { estado.fechou++ },
            on: () => {},
          })
        },
        criarStorage: (cfg: unknown) => { estado.storage++; estado.cfgStorage = cfg; return storage },
        gravarPlano: async () => { estado.gravou++; return {} },
        ...over,
      },
    )
    return { codigo, saida, out: out.join('\n'), err: err.join('\n'), estado, banco, storage }
  }

  it('sem --gravar só planeja: sem rede, com contagens e sem nomes', async () => {
    const r = await rodar([])
    expect(r.err).toBe('')
    expect(r.codigo).toBe(1)
    expect(r.estado).toMatchObject({ conectou: 0, storage: 0, gravou: 0 })
    expect(r.out).toMatch(/Duplicados: 1/)
    expect(r.out).toMatch(/Recusados: 1/)
    expect(r.out).toMatch(/Tipo desconhecido: 1/)
    expect(r.out).toMatch(/Sem paciente: 1/)
    expect(r.out).not.toContain('Sigiloso')
    expect(r.out).not.toContain('fotos_pacientes')
  })

  it.each([
    ['IMPORT_DATABASE_URL'], ['IMPORT_SUPABASE_URL'], ['IMPORT_SUPABASE_SERVICE_ROLE_KEY'],
  ])('--gravar exige %s', async (nome) => {
    const env = { ...ENV, [nome]: '' }
    const r = await rodar(['--gravar', '--confirmar-clinica', CLINICA], { env })
    expect(r.codigo).toBe(1)
    expect(r.err).toContain(nome)
    expect(r.estado.conectou).toBe(0)
  })

  it('--gravar exige --confirmar-clinica', async () => {
    const r = await rodar(['--gravar'])
    expect(r.codigo).toBe(1)
    expect(r.estado.conectou).toBe(0)
  })

  it('recusa IMPORT_SUPABASE_URL sem https, sem citar o valor', async () => {
    const env = { ...ENV, IMPORT_SUPABASE_URL: 'http://inseguro.exemplo.test' }
    const r = await rodar(['--gravar', '--confirmar-clinica', CLINICA], { env })
    expect(r.codigo).toBe(1)
    expect(r.err).not.toContain('inseguro.exemplo')
    expect(r.estado.conectou).toBe(0)
  })

  it('--gravar roda só a etapa de arquivos, salva contagens e sai com erro se algo falhou', async () => {
    const r = await rodar(['--gravar', '--confirmar-clinica', CLINICA])
    expect(r.codigo).toBe(1)
    expect(r.estado.gravou).toBe(0)
    expect(r.estado.fechou).toBe(1)
    expect(r.estado.cfgStorage).toEqual({ url: ENV.IMPORT_SUPABASE_URL, chave: SEGREDO_CHAVE })
    expect(r.storage.envios).toHaveLength(1)
    expect(r.banco.docs).toHaveLength(1)
    const json = await readFile(path.join(r.saida, 'resultado-arquivos.json'), 'utf8')
    expect(JSON.parse(json)).toMatchObject({ enviados: 1, copias: 1, recusados: 1, falhas: 2 })
    for (const texto of [json, r.out, r.err]) {
      for (const proibido of ['Sigiloso', 'fotos_pacientes/', SEGREDO_BANCO, SEGREDO_CHAVE]) expect(texto).not.toContain(proibido)
    }
  })

  it('--gravar sem falhas sai com zero', async () => {
    const r = await rodar(['--gravar', '--confirmar-clinica', CLINICA], {}, [{ nome: 'arquivos/10/a.png', corpo: PNG }])
    expect(r.err).toBe('')
    expect(r.codigo).toBe(0)
  })

  const RECUSADO = { nome: '../fora.png', corpo: JPEG }
  const VALIDO = { nome: 'arquivos/10/a.png', corpo: PNG }
  const GRAVAR = ['--gravar', '--confirmar-clinica', CLINICA]

  it('simulação só com recusados sai com erro e avisa que está incompleta', async () => {
    const r = await rodar([], {}, [RECUSADO])
    expect(r.codigo).toBe(1)
    expect(r.out).toMatch(/Importação incompleta: 1 arquivo\(s\) recusado\(s\)/)
    expect(r.out).not.toContain('fora.png')
    expect(r.estado).toMatchObject({ conectou: 0, storage: 0 })
  })

  it('simulação mista sai com erro e ainda conta os válidos', async () => {
    const r = await rodar([], {}, [RECUSADO, VALIDO])
    expect(r.codigo).toBe(1)
    expect(r.out).toMatch(/Total: 2/)
    expect(r.out).toMatch(/Importação incompleta: 1 arquivo\(s\) recusado\(s\)/)
  })

  it('simulação limpa sai com zero e não fala em incompleta', async () => {
    const r = await rodar([], {}, [VALIDO])
    expect(r.err).toBe('')
    expect(r.codigo).toBe(0)
    expect(r.out).not.toMatch(/incompleta/i)
  })

  it('--gravar só com recusados sai com erro, sem enviar nada', async () => {
    const r = await rodar(GRAVAR, {}, [RECUSADO])
    expect(r.codigo).toBe(1)
    expect(r.out).toMatch(/Importação incompleta: 1 arquivo\(s\) recusado\(s\)/)
    expect(r.out).not.toContain('fora.png')
    expect(r.storage.envios).toHaveLength(0)
    const json = JSON.parse(await readFile(path.join(r.saida, 'resultado-arquivos.json'), 'utf8'))
    expect(json).toMatchObject({ recusados: 1, falhas: 0 })
  })

  it('--gravar misto sai com erro e ainda envia os válidos', async () => {
    const r = await rodar(GRAVAR, {}, [RECUSADO, VALIDO])
    expect(r.codigo).toBe(1)
    expect(r.out).toMatch(/Importação incompleta: 1 arquivo\(s\) recusado\(s\)/)
    expect(r.storage.envios).toHaveLength(1)
    expect(r.banco.docs).toHaveLength(1)
  })

  it('--gravar limpo sai com zero e não fala em incompleta', async () => {
    const r = await rodar(GRAVAR, {}, [VALIDO])
    expect(r.err).toBe('')
    expect(r.codigo).toBe(0)
    expect(r.out).not.toMatch(/incompleta/i)
  })

  it('clínica em maiúsculas gera o mesmo caminho e o mesmo documento que em minúsculas', async () => {
    const MINUSCULA = 'abcdefab-cdef-4abc-8abc-abcdefabcdef'
    const MAIUSCULA = MINUSCULA.toUpperCase()
    const base = await rodar(['--clinica', MINUSCULA, '--gravar', '--confirmar-clinica', MINUSCULA], {}, [VALIDO])
    const r = await rodar(['--clinica', MAIUSCULA, '--gravar', '--confirmar-clinica', MAIUSCULA], {}, [VALIDO])
    expect(r.err).toBe('')
    expect(r.codigo).toBe(0)
    expect(r.storage.envios[0].caminho.startsWith(`${MINUSCULA}/${PAC_A}/`)).toBe(true)
    expect(r.storage.envios[0].caminho).toBe(base.storage.envios[0].caminho)
    expect(r.banco.docs[0].clinic_id).toBe(MINUSCULA)
    expect(r.banco.docs[0].id).toBe(base.banco.docs[0].id)
  })

  it('confirmação em outra caixa da mesma clínica é aceita; de outra clínica, não', async () => {
    const MINUSCULA = 'abcdefab-cdef-4abc-8abc-abcdefabcdef'
    const aceita = await rodar(['--clinica', MINUSCULA, '--gravar', '--confirmar-clinica', MINUSCULA.toUpperCase()], {}, [VALIDO])
    expect(aceita.codigo).toBe(0)
    const outra = await rodar(['--clinica', MINUSCULA, '--gravar', '--confirmar-clinica', PAC_A], {}, [VALIDO])
    expect(outra.codigo).toBe(1)
    expect(outra.estado.conectou).toBe(0)
  })

  it('--gravar recusa quando os pacientes ainda não foram vinculados', async () => {
    const r = await rodar(['--gravar', '--confirmar-clinica', CLINICA], {
      mapearBackup: () => ({ pacientes: [{ sourceId: 'OUTRO', numero: '10' }] }),
    })
    expect(r.codigo).toBe(1)
    expect(r.err).toMatch(/pacientes/i)
    expect(r.storage.envios).toHaveLength(0)
    expect(r.estado.fechou).toBe(1)
  })
})
