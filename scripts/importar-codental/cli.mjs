// Entrada de linha de comando. Sem --gravar roda só a simulação: nenhuma conexão com banco.
import { mkdir, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
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

export async function principal(argv, deps = {}) {
  const {
    lerBackup: ler = lerBackup,
    mapearBackup: mapear = mapearBackup,
    agora = new Date(),
    out = (s) => console.log(s),
    err = (s) => console.error(s),
  } = deps
  try {
    const { values: v } = parseArgs({
      args: argv,
      options: {
        backup: { type: 'string' }, clinica: { type: 'string' }, profissional: { type: 'string' },
        saida: { type: 'string' }, gravar: { type: 'boolean', default: false },
        'confirmar-clinica': { type: 'string' },
      },
      strict: true,
    })
    for (const o of ['backup', 'clinica', 'profissional', 'saida']) {
      if (!v[o]) throw new Error(`Opção obrigatória ausente: --${o}`)
    }
    if (!UUID.test(v.clinica)) throw new Error('--clinica deve ser um UUID')
    if (!UUID.test(v.profissional)) throw new Error('--profissional deve ser um UUID')
    if (dentroDoRepositorio(v.saida)) throw new Error('--saida não pode ficar dentro do repositório')
    if (v.gravar) throw new Error('--gravar ainda não está implementado: use apenas a simulação')

    const backup = await ler(path.resolve(v.backup))
    const plano = mapear(backup, { clinicId: v.clinica, professionalId: v.profissional, agora })
    const relatorio = montarRelatorio(plano)

    const pasta = path.resolve(v.saida)
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
