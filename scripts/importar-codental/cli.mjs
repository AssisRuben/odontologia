// Entrada de linha de comando. Sem --gravar roda só a simulação: nenhuma conexão com banco.
// Com --gravar, a conexão vem só de IMPORT_DATABASE_URL, que nunca é impressa.
import { mkdir, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import {
  BUCKET,
  ErroArquivos,
  enviarArquivos,
  lerEntradasZip,
  numerosUnicos,
  pacientesVinculados,
  planejarArquivos,
  simularArquivos,
} from './arquivos.mjs'
import { gravarPlano } from './gravar.mjs'
import { lerBackup } from './ler.mjs'
import { mapearBackup } from './mapear.mjs'
import { montarRelatorio, resumoTexto } from './relatorio.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RAIZ_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Caminho absoluto real, mesmo que o final ainda não exista. */
function caminhoReal(p) {
  let atual = path.resolve(p)
  const resto = []
  for (;;) {
    try {
      return path.join(realpathSync.native(atual), ...resto)
    } catch {
      const pai = path.dirname(atual)
      if (pai === atual) return path.resolve(p)
      resto.unshift(path.basename(atual))
      atual = pai
    }
  }
}

const normalizar = (p) => (process.platform === 'win32' ? p.toLowerCase() : p)

export function dentroDoRepositorio(saida, raiz = RAIZ_REPO) {
  const rel = path.relative(normalizar(caminhoReal(raiz)), normalizar(caminhoReal(saida)))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

const SSLMODES_VERIFICAVEIS = new Set(['require', 'verify-ca', 'verify-full'])

/**
 * Campos explícitos de conexão, com TLS verificado. Não repassa a string ao `pg`
 * porque parâmetros dela (como sslmode=no-verify) sobrescreveriam a opção ssl.
 * Os erros nunca citam a URL.
 */
export function configConexao(url) {
  let u
  try {
    u = new URL(url)
  } catch {
    throw new Error('IMPORT_DATABASE_URL inválida')
  }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') throw new Error('IMPORT_DATABASE_URL inválida')
  for (const nome of u.searchParams.keys()) {
    if (nome !== 'sslmode') throw new Error('IMPORT_DATABASE_URL tem parâmetro não aceito: deixe apenas sslmode')
  }
  const modo = u.searchParams.get('sslmode')
  if (modo !== null && !SSLMODES_VERIFICAVEIS.has(modo)) {
    throw new Error('IMPORT_DATABASE_URL: sslmode sem TLS verificado não é aceito')
  }
  const host = u.hostname.replace(/^\[|\]$/g, '')
  const database = u.pathname.slice(1)
  if (!host || !u.username || !database) throw new Error('IMPORT_DATABASE_URL incompleta')
  try {
    return {
      host,
      port: u.port ? Number(u.port) : 5432,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: decodeURIComponent(database),
      ssl: { rejectUnauthorized: true },
    }
  } catch {
    throw new Error('IMPORT_DATABASE_URL inválida')
  }
}

async function clientePadrao(cfg) {
  const { default: pg } = await import('pg')
  return new pg.Client(cfg)
}

function erroConexao(e) {
  const codigo = typeof e?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(e.code) ? e.code : 'sem código'
  return new Error(`Falha na conexão com o banco (código: ${codigo})`)
}

function resumoGravacao(r) {
  const linhas = Object.entries(r.inseridos).map(([k, n]) => `  ${k}: ${n}`)
  return [
    'Gravação concluída',
    'Inseridos:',
    ...linhas,
    `Reaproveitados: ${Object.entries(r.reaproveitados).map(([k, n]) => `${k} ${n}`).join(', ')}`,
    `Dentes: ${r.dentes} | Mensagens automáticas desativadas: ${r.mensagensDesativadas}`,
  ].join('\n')
}

async function executarGravacao(v, plano, cfg, { criarCliente, gravar, out }) {
  const cliente = await criarCliente(cfg)
  cliente.on?.('error', () => {})
  try {
    try {
      await cliente.connect()
    } catch (e) {
      throw erroConexao(e)
    }
    const resultado = await gravar(cliente, plano, {
      clinicId: v.clinica,
      professionalId: v.profissional,
      permitirExistentes: v['permitir-existentes'],
      permitirNovos: v['permitir-novos'],
    })
    out(resumoGravacao(resultado))
    return resultado
  } finally {
    await cliente.end().catch(() => {})
  }
}

/** Só a origem https do projeto. Os erros nunca citam o valor. */
function urlSupabase(valor) {
  let u
  try {
    u = new URL(valor)
  } catch {
    throw new Error('IMPORT_SUPABASE_URL inválida')
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash) {
    throw new Error('IMPORT_SUPABASE_URL deve ser apenas a origem https do projeto')
  }
  return u.origin
}

async function storagePadrao({ url, chave }) {
  const { createClient } = await import('@supabase/supabase-js')
  const bucket = createClient(url, chave, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }).storage.from(BUCKET)
  return { upload: (caminho, corpo, opcoes) => bucket.upload(caminho, corpo, opcoes) }
}

function resumoSimulacaoArquivos(r) {
  return [
    'Simulação de arquivos (nada foi enviado)',
    `Total: ${r.total}`,
    'Por categoria:',
    ...Object.entries(r.porCategoria).map(([k, n]) => `  ${k}: ${n}`),
    `Categoria desconhecida (vão para outros): ${r.categoriaDesconhecida}`,
    `Duplicados: ${r.duplicados}`,
    `Recusados: ${r.recusados}`,
    `Sem paciente: ${r.semPaciente}`,
    `Tipo desconhecido: ${r.tipoDesconhecido}`,
    `Ilegíveis: ${r.ilegiveis}`,
  ].join('\n')
}

function resumoEnvioArquivos(r) {
  return [
    'Envio de arquivos concluído',
    `Total: ${r.total} | Enviados: ${r.enviados} | Cópias: ${r.copias} | Já registrados: ${r.jaRegistrados}`,
    `Recusados: ${r.recusados} | Falhas: ${r.falhas}`,
    `Motivos: ${Object.entries(r.motivos).map(([k, n]) => `${k} ${n}`).join(', ')}`,
  ].join('\n')
}

async function simularEtapaArquivos(v, plano, { lerZip, out }) {
  const zip = await lerZip(path.resolve(v.arquivos))
  try {
    const planejados = planejarArquivos(zip.entradas, numerosUnicos(plano.pacientes))
    out(resumoSimulacaoArquivos(await simularArquivos(planejados)))
    return 0
  } finally {
    await zip.fechar()
  }
}

/** Só a etapa de arquivos: os pacientes já precisam ter sido gravados em outra execução. */
async function gravarEtapaArquivos(v, plano, pasta, cfg, { criarCliente, criarStorage, lerZip, out, err }) {
  await mkdir(pasta, { recursive: true })
  const cliente = await criarCliente(cfg.conexao)
  cliente.on?.('error', () => {})
  try {
    try {
      await cliente.connect()
    } catch (e) {
      throw erroConexao(e)
    }
    const clinica = await cliente.query('SELECT id FROM clinics WHERE id = $1', [v.clinica])
    if (!clinica.rows.length) throw new ErroArquivos('Envio recusado. Clínica não encontrada.')
    const pacientes = await pacientesVinculados(cliente, v.clinica, plano.pacientes)
    if (!pacientes.size) throw new ErroArquivos('Envio recusado. Nenhum dos pacientes do backup está vinculado: grave os pacientes antes.')

    const storage = await criarStorage(cfg.storage)
    const zip = await lerZip(path.resolve(v.arquivos))
    let resultado
    try {
      resultado = await enviarArquivos({ cliente, storage }, planejarArquivos(zip.entradas, pacientes), { clinicId: v.clinica })
    } finally {
      await zip.fechar()
    }
    out(resumoEnvioArquivos(resultado))
    try {
      await writeFile(path.join(pasta, 'resultado-arquivos.json'), JSON.stringify(resultado, null, 2) + '\n', 'utf8')
    } catch {
      err('O envio foi concluído, mas o arquivo de resultado não pôde ser salvo.')
      return 1
    }
    return resultado.falhas > 0 ? 1 : 0
  } finally {
    await cliente.end().catch(() => {})
  }
}

/** Erros de banco, Storage ou ZIP podem citar caminhos: só passam mensagens já seguras. */
async function comErroSeguro(fn) {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof ErroArquivos || /^Falha na conexão com o banco/.test(e?.message ?? '')) throw e
    const codigo = typeof e?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(e.code) ? e.code : 'sem código'
    throw new ErroArquivos(`Falha na etapa de arquivos (código: ${codigo})`)
  }
}

export async function principal(argv, deps = {}) {
  const {
    lerBackup: ler = lerBackup,
    mapearBackup: mapear = mapearBackup,
    agora = new Date(),
    out = (s) => console.log(s),
    err = (s) => console.error(s),
    env = process.env,
    criarCliente = clientePadrao,
    gravarPlano: gravar = gravarPlano,
    criarStorage = storagePadrao,
    lerZip = lerEntradasZip,
  } = deps
  try {
    const { values: v } = parseArgs({
      args: argv,
      options: {
        backup: { type: 'string' }, clinica: { type: 'string' }, profissional: { type: 'string' },
        saida: { type: 'string' }, gravar: { type: 'boolean', default: false },
        'confirmar-clinica': { type: 'string' },
        'permitir-existentes': { type: 'boolean', default: false },
        'permitir-novos': { type: 'boolean', default: false },
        arquivos: { type: 'string' },
      },
      strict: true,
    })
    for (const o of ['backup', 'clinica', 'profissional', 'saida']) {
      if (!v[o]) throw new Error(`Opção obrigatória ausente: --${o}`)
    }
    if (!UUID.test(v.clinica)) throw new Error('--clinica deve ser um UUID')
    if (!UUID.test(v.profissional)) throw new Error('--profissional deve ser um UUID')
    if (dentroDoRepositorio(v.saida)) throw new Error('--saida não pode ficar dentro do repositório')
    let cfgConexao = null
    if (v.gravar) {
      if (v['confirmar-clinica'] !== v.clinica) throw new Error('--gravar exige --confirmar-clinica igual a --clinica')
      if (!env.IMPORT_DATABASE_URL) throw new Error('--gravar exige a variável de ambiente IMPORT_DATABASE_URL')
      cfgConexao = configConexao(env.IMPORT_DATABASE_URL)
    }
    let cfgStorage = null
    if (v.gravar && v.arquivos) {
      if (!env.IMPORT_SUPABASE_URL) throw new Error('--gravar --arquivos exige a variável de ambiente IMPORT_SUPABASE_URL')
      if (!env.IMPORT_SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error('--gravar --arquivos exige a variável de ambiente IMPORT_SUPABASE_SERVICE_ROLE_KEY')
      }
      cfgStorage = { url: urlSupabase(env.IMPORT_SUPABASE_URL), chave: env.IMPORT_SUPABASE_SERVICE_ROLE_KEY }
    }

    const backup = await ler(path.resolve(v.backup))
    const plano = mapear(backup, { clinicId: v.clinica, professionalId: v.profissional, agora })
    const pasta = path.resolve(v.saida)

    if (v.arquivos) {
      return await comErroSeguro(() => (v.gravar
        ? gravarEtapaArquivos(v, plano, pasta, { conexao: cfgConexao, storage: cfgStorage }, { criarCliente, criarStorage, lerZip, out, err })
        : simularEtapaArquivos(v, plano, { lerZip, out })))
    }

    if (v.gravar) {
      await mkdir(pasta, { recursive: true })
      const resultado = await executarGravacao(v, plano, cfgConexao, { criarCliente, gravar, out })
      try {
        await writeFile(path.join(pasta, 'resultado-gravacao.json'), JSON.stringify(resultado, null, 2) + '\n', 'utf8')
      } catch {
        err('A gravação no banco foi concluída, mas o arquivo de resultado não pôde ser salvo.')
        return 1
      }
      return 0
    }

    const relatorio = montarRelatorio(plano)
    await mkdir(pasta, { recursive: true })
    await writeFile(path.join(pasta, 'relatorio-simulacao.json'), JSON.stringify(relatorio, null, 2) + '\n', 'utf8')
    out(resumoTexto(relatorio))
    return 0
  } catch (e) {
    err(e instanceof Error ? e.message : 'Erro desconhecido')
    return 1
  }
}

const executadoDireto = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (executadoDireto) process.exitCode = await principal(process.argv.slice(2))
