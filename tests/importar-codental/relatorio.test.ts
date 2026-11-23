import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { montarRelatorio } from '../../scripts/importar-codental/relatorio.mjs'
import { principal } from '../../scripts/importar-codental/cli.mjs'

const NOME = 'Fulano Sigiloso'
const CPF = '12345678909'
const FONE = '11999998888'
const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'

const plano = () => ({
  pacientes: [
    { sourceId: 'P1', name: NOME, cpf: CPF, phone: FONE },
    { sourceId: 'P2', name: 'Outra Pessoa', cpf: null, phone: null },
  ],
  convenios: [{ sourceId: 'C1', name: 'Plano Secreto' }],
  procedimentos: [{ sourceId: 'PR1' }, { sourceId: 'PR2' }],
  consultas: [
    { sourceId: 'a', status: 'completed', imported_from: 'codental' },
    { sourceId: 'b', status: 'cancelled', imported_from: 'codental' },
    { sourceId: 'c', status: 'scheduled', imported_from: null },
  ],
  evolucoes: [{ sourceId: 'e1', description: 'texto livre sigiloso' }],
  tratamentos: [
    { sourceId: 'T1', pacienteSourceId: 'P1', orcamentoSourceId: 'O1', status: 'completed', imported_from: 'codental' },
    { sourceId: 'T2', pacienteSourceId: 'P1', orcamentoSourceId: 'O2', status: 'planned', imported_from: null },
    { sourceId: 'T3', pacienteSourceId: 'P1', orcamentoSourceId: null, status: 'planned', imported_from: null },
  ],
  orcamentos: [
    { sourceId: 'O1', pacienteSourceId: 'P1', status: 'approved', total: 100.1, itens: [{}, {}] },
    { sourceId: 'O2', pacienteSourceId: 'P2', status: 'draft', total: 0.2, itens: [{}] },
  ],
  historico: [
    { sourceId: 'h1', pacienteSourceId: 'P1', orcamentoSourceId: 'O1', amount: 0.1, original_status: 'paid' },
    { sourceId: 'h2', pacienteSourceId: 'P1', orcamentoSourceId: 'O1', amount: 0.2, original_status: 'paid' },
    { sourceId: 'h3', pacienteSourceId: 'P1', orcamentoSourceId: 'O2', amount: 50.55, original_status: 'open' },
    { sourceId: 'h4', pacienteSourceId: 'P1', orcamentoSourceId: null, amount: 1, original_status: 'open' },
  ],
  avisos: { tratamentosSemValor: 3, consultasSemDesfecho: 1, evolucoesRepetidas: 0, gruposNomeNascimento: 2, telefonesCompartilhados: 4, pagamentoAntesDoVencimentoAno: 5 },
})

describe('montarRelatorio', () => {
  const r = montarRelatorio(plano())

  it('conta entidades e itens', () => {
    expect(r.contagens).toEqual({
      pacientes: 2, convenios: 1, procedimentos: 2, consultas: 3, evolucoes: 1,
      tratamentos: 3, itensOrcamento: 3, orcamentos: 2, historico: 4,
    })
  })
  it('separa consultas e tratamentos por status e origem', () => {
    expect(r.consultas).toEqual({ porStatus: { completed: 1, cancelled: 1, scheduled: 1 }, importadas: 2, vivas: 1 })
    expect(r.tratamentos).toEqual({ porStatus: { completed: 1, planned: 2 }, importados: 1, vivos: 2 })
  })
  it('soma orçamentos e histórico em centavos inteiros', () => {
    expect(r.orcamentos.porStatus).toEqual({ approved: 1, draft: 1 })
    expect(r.orcamentos.totalCentavos).toBe(10030)
    expect(r.historico.pago).toEqual({ quantidade: 2, centavos: 30 })
    expect(r.historico.emAberto).toEqual({ quantidade: 2, centavos: 5155 })
  })
  it('traz avisos e vínculos com orçamento de outro paciente', () => {
    expect(r.avisos).toEqual(plano().avisos)
    expect(r.tratamentosOrcamentoOutroPaciente).toBe(1)
    expect(r.historicoOrcamentoOutroPaciente).toBe(1)
  })
  it('não vaza nome, CPF, telefone, texto livre ou ids de origem', () => {
    const s = JSON.stringify(r)
    for (const proibido of [NOME, CPF, FONE, 'Plano Secreto', 'sigiloso', 'P1', 'O1', 'T1']) {
      expect(s).not.toContain(proibido)
    }
  })
})

describe('cli principal', () => {
  const limpar: string[] = []
  afterEach(async () => { while (limpar.length) await rm(limpar.pop()!, { recursive: true, force: true }) })

  const repo = path.resolve(__dirname, '../..')
  const rodar = async (args: string[], over: Record<string, unknown> = {}) => {
    const out: string[] = []
    const err: string[] = []
    let leu = 0
    const codigo = await principal(args, {
      lerBackup: async () => { leu++; return {} },
      mapearBackup: () => plano(),
      agora: new Date('2026-06-01T12:00:00Z'),
      out: (s: string) => out.push(s),
      err: (s: string) => err.push(s),
      ...over,
    })
    return { codigo, out: out.join('\n'), err: err.join('\n'), leu: () => leu }
  }
  const base = (saida: string) => ['--backup', 'pasta', '--clinica', UUID_A, '--profissional', UUID_B, '--saida', saida]

  it('grava o relatório JSON fora do repositório e imprime resumo', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'imp-'))
    limpar.push(dir)
    const r = await rodar(base(path.join(dir, 'sub')))
    expect(r.codigo).toBe(0)
    const json = await readFile(path.join(dir, 'sub', 'relatorio-simulacao.json'), 'utf8')
    expect(JSON.parse(json).contagens.pacientes).toBe(2)
    for (const s of [json, r.out]) for (const p of [NOME, CPF, FONE]) expect(s).not.toContain(p)
    expect(r.out).toContain('2')
  })

  it.each<[string, () => string]>([
    ['dentro do repositório', () => path.join(repo, 'saida-x')],
    ['com ..', () => path.join(repo, 'scripts', '..', 'saida-x')],
    ...(process.platform === 'win32' ? [['com caixa diferente', () => path.join(repo.toUpperCase(), 'saida-x')] as [string, () => string]] : []),
    ['o próprio repositório', () => repo],
  ])('recusa --saida %s antes de ler o backup', async (_n, f) => {
    const r = await rodar(base(f()))
    expect(r.codigo).not.toBe(0)
    expect(r.leu()).toBe(0)
  })

  it('exige UUIDs válidos', async () => {
    const r = await rodar(['--backup', 'p', '--clinica', 'x', '--profissional', UUID_B, '--saida', os.tmpdir()])
    expect(r.codigo).not.toBe(0)
    expect(r.leu()).toBe(0)
  })

  it('--gravar sai com erro sem abrir conexão nem ler o backup', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'imp-'))
    limpar.push(dir)
    const r = await rodar([...base(dir), '--gravar'])
    expect(r.codigo).not.toBe(0)
    expect(r.err).toMatch(/gravar/i)
    expect(r.leu()).toBe(0)
  })

  it('erro fatal imprime só a mensagem, sem stack', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'imp-'))
    limpar.push(dir)
    const r = await rodar(base(dir), { lerBackup: async () => { throw new Error('Planilha x, linha 3: inválido') } })
    expect(r.codigo).not.toBe(0)
    expect(r.err).toBe('Planilha x, linha 3: inválido')
  })
})
