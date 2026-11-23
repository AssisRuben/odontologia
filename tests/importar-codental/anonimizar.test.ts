import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import { strFromU8, unzipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { anonimizarBackup } from '../../scripts/importar-codental/anonimizar.mjs'
import { dentroDoRepositorio, principal } from '../../scripts/importar-codental/cli.mjs'
import { COLUNAS, dataYmd, lerBackup } from '../../scripts/importar-codental/ler.mjs'
import { mapearBackup } from '../../scripts/importar-codental/mapear.mjs'
import { montarRelatorio } from '../../scripts/importar-codental/relatorio.mjs'
import { normalizePhone } from '../../src/lib/messaging/phone'
import { isValidCpf } from '../../src/lib/payments/cpf'

type Linha = Record<string, unknown>
type Backup = Record<string, Linha[]>

const AGORA = new Date('2026-06-01T12:00:00Z')
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const CPF_A = '52998224725'
const CPF_B = '11144477735'
const CPF_ZERO = '01234567890'
const FONE_A = '11987654321'
const FONE_B = '21976543210'
const FONE_C = '3133224455'
const EMAIL_A = 'marta.sigilosa@correio.test'
const CARTAO_A = '8877665544'

const SEGREDOS = [
  'Marta Sigilosa', 'Bruno Reservado', 'Clara Oculta', 'Dra. Helena Privada', 'Dr. Otavio Secreto', 'usuario.helena', 'usuario.otavio',
  CPF_A, '529.982.247-25', CPF_B, CPF_ZERO, FONE_A, '(11) 98765-4321', FONE_B, FONE_C, '41999990000', '11955554444',
  EMAIL_A, 'bruno@correio.test', 'helena@correio.test', 'otavio@correio.test', CARTAO_A, '99887766',
  '98765432100', '12345678900', 'CRO-1234',
  'Rua das Palmeiras 42', 'Apto 901', 'Jardim Escondido', 'Vila Discreta', '01310-100', 'MG-12.345.678',
  'Engenheira de pontes', 'Parente Confidencial', 'Tutor Confidencial', 'Indicada pela vizinha',
  'Alergia a penicilina', 'Paciente ansiosa', 'Dor no siso esquerdo', 'Retorno combinado', 'Etiqueta sensível',
  'Plano de tratamento da Marta', 'Observação de orçamento', 'Entrada do Bruno', 'Canal no dente da Marta',
  'Atendida pela recepcionista Joana',
]

const paciente = (over: Linha): Linha => ({
  ...Object.fromEntries(COLUNAS.pacientes.map((c: string) => [c, null])),
  'Data de criação': '10/01/2024',
  ...over,
})

function fixture(): Backup {
  const backup: Backup = {
    pacientes: [
      paciente({
        _linha: 2, ID: 'P1', Numero: '101', 'Nome completo': 'Marta Sigilosa', 'Profissão': 'Engenheira de pontes',
        CPF: '529.982.247-25', RG: 'MG-12.345.678', 'Data de nascimento': 32874, Sexo: 'Feminino', CEP: '01310-100',
        'Endereço': 'Rua das Palmeiras 42', Complemento: 'Apto 901', Bairro: 'Jardim Escondido', Cidade: 'Vila Discreta', Estado: 'MG',
        Email: EMAIL_A, Celular: '(11) 98765-4321', 'Contato de emergência nome': 'Parente Confidencial',
        'Contato de emergência telefone': '41999990000', Telefone: FONE_C, 'Responsável nome': 'Tutor Confidencial',
        'Responsável CPF': '98765432100', 'Responsável data de nascimento': 21916, 'Nome do plano': 'Plano Teste',
        'Numero da carterinha': CARTAO_A, 'CPF do titular': CPF_B, 'Observações': 'Alergia a penicilina',
        'Anotações': 'Paciente ansiosa', 'Como conheceu': 'Indicada pela vizinha', 'Última consulta': '02/02/2025',
      }),
      // Mesmo celular de P1, escrito de outra forma.
      paciente({
        _linha: 3, ID: 'P2', Numero: '102', 'Nome completo': 'Bruno Reservado', CPF: CPF_B, 'Data de nascimento': '15/03/1985',
        Sexo: 'Masculino', Email: 'BRUNO@correio.test', Celular: FONE_A, Telefone: '11955554444', 'Nome do plano': 'Particular',
        'Numero da carterinha': '99887766', 'CPF do titular': '12345678900',
      }),
      // CPF numérico perde o zero à esquerda; a outra planilha o traz como texto.
      paciente({
        _linha: 4, ID: 'P3', Numero: '103', 'Nome completo': 'Clara Oculta', CPF: Number(CPF_ZERO),
        'Data de nascimento': new Date(Date.UTC(1972, 6, 9)), Celular: FONE_B,
      }),
      paciente({ _linha: 5, ID: 'P4', Numero: '104', 'Nome completo': 'Clara Oculta' }),
    ],
    consultas: [
      { _linha: 2, Paciente: 'Marta Sigilosa', 'ID Paciente': 'P1', Dentista: 'Dra. Helena Privada', 'ID Dentista': 'D1', 'Data consulta': '05/02/2025 09:30', 'Duração': 30, Status: 'Finalizada', Celular: FONE_A, Etiquetas: 'Etiqueta sensível', 'Observação': 'Retorno combinado', 'Cadastrada por': 'Atendida pela recepcionista Joana' },
      { _linha: 3, Paciente: 'Marta Sigilosa', 'ID Paciente': 'P1', Dentista: 'Dra. Helena Privada', 'ID Dentista': 'D1', 'Data consulta': '05/02/2025 09:30', 'Duração': 30, Status: 'Faltou', Celular: FONE_A, Etiquetas: null, 'Observação': null, 'Cadastrada por': 'Atendida pela recepcionista Joana' },
      { _linha: 4, Paciente: 'Bruno Reservado', 'ID Paciente': 'P2', Dentista: 'Dr. Otavio Secreto', 'ID Dentista': 'D2', 'Data consulta': '10/03/2025 14:00', 'Duração': 60, Status: 'Agendada', Celular: FONE_A, Etiquetas: null, 'Observação': null, 'Cadastrada por': null },
      { _linha: 5, Paciente: 'Clara Oculta', 'ID Paciente': 'P3', Dentista: 'Dr. Otavio Secreto', 'ID Dentista': 'D2', 'Data consulta': '10/08/2026 08:00', 'Duração': 45, Status: 'Confirmada', Celular: FONE_B, Etiquetas: null, 'Observação': null, 'Cadastrada por': null },
    ],
    convenios: [
      { _linha: 2, ID: 'PR1', Procedimento: 'Limpeza', Valor: 'R$ 150,00', Ativo: 'Sim', Categoria: 'Prevenção', 'Convênio': 'Plano Teste', 'ID Convênio': 'C1' },
      { _linha: 3, ID: 'PR2', Procedimento: 'Limpeza', Valor: 'R$ 120,00', Ativo: 'Sim', Categoria: 'Prevenção', 'Convênio': 'Particular', 'ID Convênio': 'C0' },
    ],
    evolucoes: [
      { _linha: 2, ID: 'E1', Paciente: 'Marta Sigilosa', 'ID Paciente': 'P1', 'CPF Paciente': CPF_A, 'Número Paciente': '101', Dentista: 'Dra. Helena Privada', 'Descrição': 'Dor no siso esquerdo', Data: '05/02/2025', 'Data de criação': '05/02/2025', 'Última atualização': '05/02/2025' },
      { _linha: 3, ID: 'E2', Paciente: 'Marta Sigilosa', 'ID Paciente': 'P1', 'CPF Paciente': '529.982.247-25', 'Número Paciente': '101', Dentista: 'Dra. Helena Privada', 'Descrição': 'Dor no siso esquerdo', Data: '05/02/2025', 'Data de criação': '05/02/2025', 'Última atualização': '05/02/2025' },
      { _linha: 4, ID: 'E3', Paciente: 'Clara Oculta', 'ID Paciente': 'P3', 'CPF Paciente': CPF_ZERO, 'Número Paciente': '103', Dentista: 'Dr. Otavio Secreto', 'Descrição': null, Data: '06/02/2025', 'Data de criação': '06/02/2025', 'Última atualização': '06/02/2025' },
    ],
    orcamentos: [
      { _linha: 2, ID: 'O1', Paciente: 'Marta Sigilosa', 'ID Paciente': 'P1', 'CPF Paciente': CPF_A, 'Número Paciente': '101', 'Orçamento': 'Plano de tratamento da Marta', 'Valor da entrada': 'R$ 50,00', Desconto: 'R$ 10,00', 'Valor total': 'R$ 150,00', 'Parcelado?': 'Sim', Aprovado: 'Sim', Parcelas: '3', 'Observações': 'Observação de orçamento', 'Data de criação': '01/02/2025', 'Última atualização': '01/02/2025' },
    ],
    pagamentos: [
      { _linha: 2, Paciente: 'Marta Sigilosa', 'ID Paciente': 'P1', 'CPF Paciente': CPF_A, 'Número Paciente': '101', Pagamento: 'Entrada do Bruno', 'Valor total': 'R$ 50,00', 'Valor liquído': 'R$ 50,00', 'Data de vencimento': '01/02/2025', 'Data de pagamento': '01/02/2025', 'Forma de pagamento': 'Pix', Parcela: 1, 'Total de parcelas': 3, 'Data de criação': '01/02/2025', 'Última atualização': '01/02/2025', 'ID orçamento': 'O1', Tratamentos: '["Canal no dente da Marta"]', Profissionais: 'Dra. Helena Privada' },
      { _linha: 3, Paciente: 'Marta Sigilosa', 'ID Paciente': 'P1', 'CPF Paciente': CPF_A, 'Número Paciente': '101', Pagamento: 'Entrada do Bruno', 'Valor total': 'R$ 50,00', 'Valor liquído': 'R$ 50,00', 'Data de vencimento': '01/03/2025', 'Data de pagamento': null, 'Forma de pagamento': null, Parcela: '-', 'Total de parcelas': '-', 'Data de criação': '01/02/2025', 'Última atualização': '01/02/2025', 'ID orçamento': 'O1', Tratamentos: null, Profissionais: null },
    ],
    tratamentos: [
      { _linha: 2, ID: 'T1', Paciente: 'Marta Sigilosa', 'ID Paciente': 'P1', 'CPF Paciente': CPF_A, 'Número Paciente': '101', Dentista: 'Dra. Helena Privada', Procedimento: 'Limpeza', 'Convênio': 'Plano Teste', Finalizado: 'Sim', Dente: '11, 12', Faces: 'M, V', 'ID orçamento': 'O1', 'Data de criação': '01/02/2025', 'Última atualização': '01/02/2025' },
      { _linha: 3, ID: 'T2', Paciente: 'Bruno Reservado', 'ID Paciente': 'P2', 'CPF Paciente': CPF_B, 'Número Paciente': '102', Dentista: 'Dr. Otavio Secreto', Procedimento: 'Limpeza', 'Convênio': 'Particular', Finalizado: 'Não', Dente: '---', Faces: '---', 'ID orçamento': null, 'Data de criação': '03/02/2025', 'Última atualização': '03/02/2025' },
    ],
    profissionais: [
      { _linha: 2, ID: 'D1', 'Usuário': 'usuario.helena', Nome: 'Dra. Helena Privada', CPF: CPF_B, CRO: 'CRO-1234', 'UF CRO': 'MG', Email: 'helena@correio.test', Telefone: '11955554444', 'Data de criação': '01/01/2020' },
      { _linha: 3, ID: 'D2', 'Usuário': 'usuario.otavio', Nome: 'Dr. Otavio Secreto', CPF: null, CRO: null, 'UF CRO': null, Email: 'otavio@correio.test', Telefone: null, 'Data de criação': '01/01/2021' },
    ],
  }
  return backup
}

function rngDe(semente: number) {
  let s = semente >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const anonimo = (semente = 7): Backup => anonimizarBackup(fixture(), { rng: rngDe(semente) })
const coluna = (linhas: Linha[], c: string) => linhas.map((l) => l[c])
const relatorioSemNomes = (b: Backup) => {
  const r = montarRelatorio(mapearBackup(b, { agora: AGORA }))
  const avisos: Partial<typeof r.avisos> = { ...r.avisos }
  delete avisos.gruposNomeNascimento
  return { ...r, avisos }
}

function vazamentos(texto: string) {
  return SEGREDOS.filter((s) => texto.includes(s))
}

describe('anonimizarBackup', () => {
  it('troca os dados pessoais do paciente', () => {
    const [p] = anonimo().pacientes
    expect(p['Nome completo']).toMatch(/^Paciente \d{6,}$/)
    expect(p.CPF).toMatch(/^\d{11}$/)
    expect(p.Email).toMatch(/^\d{6,}@example\.invalid$/)
    expect(p['Numero da carterinha']).toMatch(/^\d+$/)
    expect(String(p['Numero da carterinha']).length).toBeLessThanOrEqual(30)
    expect(p['Data de nascimento']).not.toBe(32874)
    for (const c of ['Profissão', 'RG', 'CEP', 'Endereço', 'Complemento', 'Bairro', 'Cidade', 'Contato de emergência nome', 'Responsável nome', 'Observações', 'Anotações', 'Como conheceu']) {
      expect(p[c], c).not.toBe(fixture().pacientes[0][c])
      expect(p[c], c).toBeTruthy()
    }
  })

  it('não usa Numero nem a ordem das linhas para formar o nome', () => {
    const nomes = coluna(anonimo().pacientes, 'Nome completo') as string[]
    expect(nomes.some((n) => n.endsWith('000101') || n.endsWith('000001'))).toBe(false)
    expect(new Set(nomes).size).toBe(nomes.length)
  })

  it('dá nomes diferentes a pacientes homônimos', () => {
    const [, , p3, p4] = anonimo().pacientes
    expect(p3['Nome completo']).not.toBe(p4['Nome completo'])
  })

  it('mantém o mesmo substituto do paciente em todas as planilhas', () => {
    const a = anonimo()
    const nome = a.pacientes[0]['Nome completo']
    const cpf = a.pacientes[0].CPF
    for (const planilha of ['consultas', 'evolucoes', 'orcamentos', 'pagamentos', 'tratamentos']) {
      for (const l of a[planilha].filter((x) => x['ID Paciente'] === 'P1')) {
        expect(l.Paciente, planilha).toBe(nome)
        if ('CPF Paciente' in l) expect(l['CPF Paciente'], planilha).toBe(cpf)
      }
    }
  })

  it('reconhece o mesmo CPF escrito de formas diferentes, inclusive sem zero à esquerda', () => {
    const a = anonimo()
    expect(a.pacientes[2].CPF).toBe(a.evolucoes[2]['CPF Paciente'])
    expect(a.pacientes[1].CPF).toBe(a.pacientes[0]['CPF do titular'])
  })

  it('gera CPF de 11 dígitos sempre com dígito verificador inválido', () => {
    for (let semente = 1; semente <= 50; semente++) {
      const a = anonimizarBackup(fixture(), { rng: rngDe(semente) })
      const cpfs = [...coluna(a.pacientes, 'CPF'), ...coluna(a.pacientes, 'Responsável CPF'), ...coluna(a.pacientes, 'CPF do titular')].filter(Boolean)
      expect(cpfs.length).toBeGreaterThan(0)
      for (const c of cpfs) {
        expect(c).toMatch(/^\d{11}$/)
        expect(isValidCpf(String(c))).toBe(false)
      }
    }
  })

  it('telefones usam DDD 10, continuam repetidos e o app os reconhece como DDD 10', () => {
    const a = anonimo()
    const [p1, p2, p3] = a.pacientes
    expect(p1.Celular).toBe(p2.Celular)
    expect(a.consultas[0].Celular).toBe(p1.Celular)
    expect(p3.Celular).not.toBe(p1.Celular)
    const fones = [
      ...coluna(a.pacientes, 'Celular'), ...coluna(a.pacientes, 'Telefone'),
      ...coluna(a.pacientes, 'Contato de emergência telefone'), ...coluna(a.consultas, 'Celular'),
    ].filter(Boolean)
    for (const f of fones) {
      expect(f).toMatch(/^109\d{8}$/)
      expect(normalizePhone(String(f))).toBe(`55${f}`)
    }
  })

  it('profissionais viram fictícios, sem CPF, CRO ou telefone, e o nome acompanha o ID', () => {
    const a = anonimo()
    const [d1, d2] = a.profissionais
    expect(d1.Nome).toMatch(/^Profissional \d+$/)
    expect(d1.Nome).not.toBe(d2.Nome)
    expect(d1.Email).toMatch(/@example\.invalid$/)
    for (const c of ['CPF', 'CRO', 'UF CRO', 'Telefone']) expect(d1[c], c).toBeNull()
    expect(a.consultas[0].Dentista).toBe(d1.Nome)
    expect(a.evolucoes[0].Dentista).toBe(d1.Nome)
    expect(a.tratamentos[1].Dentista).toBe(d2.Nome)
    expect(a.consultas[0]['Cadastrada por']).not.toBe(fixture().consultas[0]['Cadastrada por'])
  })

  it('preserva vazios e a presença de cada valor', () => {
    const original = fixture()
    const a = anonimo()
    for (const planilha of Object.keys(COLUNAS)) {
      if (planilha === 'profissionais') continue
      a[planilha].forEach((l, i) => {
        for (const c of COLUNAS[planilha as keyof typeof COLUNAS]) {
          expect(l[c] === null, `${planilha}.${c}`).toBe((original[planilha][i][c] ?? null) === null)
        }
      })
    }
  })

  it('preserva IDs, status, datas, valores, planos, procedimentos, dentes e vínculos', () => {
    const o = fixture()
    const a = anonimo()
    const manter: Record<string, string[]> = {
      pacientes: ['ID', 'Numero', 'Sexo', 'Nome do plano', 'Data de criação', 'Última consulta'],
      consultas: ['ID Paciente', 'ID Dentista', 'Data consulta', 'Duração', 'Status'],
      convenios: COLUNAS.convenios,
      evolucoes: ['ID', 'ID Paciente', 'Número Paciente', 'Data', 'Data de criação', 'Última atualização'],
      orcamentos: ['ID', 'ID Paciente', 'Número Paciente', 'Valor da entrada', 'Desconto', 'Valor total', 'Parcelado?', 'Aprovado', 'Parcelas', 'Data de criação', 'Última atualização'],
      pagamentos: ['ID Paciente', 'Número Paciente', 'Valor total', 'Valor liquído', 'Data de vencimento', 'Data de pagamento', 'Forma de pagamento', 'Parcela', 'Total de parcelas', 'Data de criação', 'Última atualização', 'ID orçamento'],
      tratamentos: ['ID', 'ID Paciente', 'Número Paciente', 'Procedimento', 'Convênio', 'Finalizado', 'Dente', 'Faces', 'ID orçamento', 'Data de criação', 'Última atualização'],
      profissionais: ['ID', 'Data de criação'],
    }
    for (const [planilha, colunas] of Object.entries(manter)) {
      for (const c of colunas) expect(coluna(a[planilha], c), `${planilha}.${c}`).toEqual(coluna(o[planilha], c))
    }
  })

  it('nascimentos são datas passadas válidas no mesmo formato da célula', () => {
    const [p1, p2, p3, p4] = anonimo().pacientes
    expect(typeof p1['Data de nascimento']).toBe('number')
    expect(typeof p1['Responsável data de nascimento']).toBe('number')
    expect(p2['Data de nascimento']).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
    expect(p3['Data de nascimento']).toBeInstanceOf(Date)
    expect(p4['Data de nascimento']).toBeNull()
    const onde = { planilha: 'pacientes', coluna: 'Data de nascimento', linha: 2 }
    for (const v of [p1['Data de nascimento'], p2['Data de nascimento'], p3['Data de nascimento']]) {
      expect(dataYmd(v, onde)! < AGORA.toISOString().slice(0, 10)).toBe(true)
    }
    expect(dataYmd(p2['Data de nascimento'], onde)).not.toBe('1985-03-15')
  })

  it('recusa nascimento ilegível sem citar o valor', () => {
    const b = fixture()
    b.pacientes[0]['Data de nascimento'] = 'Marta nasceu em maio'
    let msg = ''
    try {
      anonimizarBackup(b, { rng: rngDe(1) })
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).toContain('Data de nascimento')
    expect(msg).not.toContain('Marta')
  })

  it('texto livre vira texto neutro e evolução repetida continua repetida', () => {
    const a = anonimo()
    expect(a.evolucoes[0]['Descrição']).toBe(a.evolucoes[1]['Descrição'])
    expect(a.evolucoes[0]['Descrição']).toMatch(/^Texto fictício \d+$/)
    expect(a.evolucoes[2]['Descrição']).toBeNull()
    expect(a.pagamentos[0].Pagamento).toMatch(/^Texto fictício \d+$/)
    expect(JSON.parse(String(a.pagamentos[0].Tratamentos))).toEqual([expect.stringMatching(/^Texto fictício \d+$/)])
  })

  it('não deixa escapar nenhum dado original, nem colunas fora do contrato', () => {
    const b = fixture()
    b.pacientes[0]['Coluna nova'] = 'Marta Sigilosa'
    const saida = JSON.stringify(anonimizarBackup(b, { rng: rngDe(3) }))
    expect(vazamentos(saida)).toEqual([])
  })

  it('o relatório agregado bate com o original', () => {
    const o = relatorioSemNomes(fixture())
    expect(relatorioSemNomes(anonimo())).toEqual(o)
    expect(o.avisos.telefonesCompartilhados).toBe(1)
    expect(o.avisos.evolucoesRepetidas).toBe(1)
  })

  it('substitutos mudam entre execuções e não dependem do valor original', () => {
    expect(anonimo(1).pacientes[0].CPF).not.toBe(anonimo(2).pacientes[0].CPF)
    const b = fixture()
    b.pacientes[0].CPF = CPF_B
    b.pacientes[1].CPF = CPF_A
    const mesmaSemente = anonimizarBackup(b, { rng: rngDe(7) })
    expect(mesmaSemente.pacientes[0].CPF).toBe(anonimo(7).pacientes[0].CPF)
  })

  it('substitutos seguem únicos mesmo com um gerador degenerado', () => {
    const a = anonimizarBackup(fixture(), { rng: () => 0 })
    const nomes = coluna(a.pacientes, 'Nome completo')
    expect(new Set(nomes).size).toBe(nomes.length)
    expect(a.pacientes[0].Celular).not.toBe(a.pacientes[2].Celular)
  })

  it('recusa gerador fora do intervalo', () => {
    expect(() => anonimizarBackup(fixture(), { rng: () => 1 })).toThrow(/gerador/i)
  })

  it('não altera o backup recebido', () => {
    const b = fixture()
    anonimizarBackup(b, { rng: rngDe(1) })
    expect(b).toEqual(fixture())
  })
})

describe('dentroDoRepositorio', () => {
  it('reconhece pasta filha cujo nome começa com dois pontos', () => {
    expect(dentroDoRepositorio(path.join(REPO, '..saida'))).toBe(true)
    expect(dentroDoRepositorio(path.join(REPO, '..', 'irma'))).toBe(false)
  })
})

describe('CLI --anonimizar', () => {
  const limpar: string[] = []
  afterEach(async () => { while (limpar.length) await rm(limpar.pop()!, { recursive: true, force: true }) })

  async function temp() {
    const d = await mkdtemp(path.join(os.tmpdir(), 'anon-'))
    limpar.push(d)
    return d
  }

  async function gravarFixture(pasta: string) {
    const b = fixture()
    for (const [planilha, colunas] of Object.entries(COLUNAS)) {
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Planilha')
      ws.addRow([...(colunas as string[]), 'Coluna extra'])
      for (const l of b[planilha]) ws.addRow([...(colunas as string[]).map((c) => l[c] ?? null), 'Marta Sigilosa'])
      await wb.xlsx.writeFile(path.join(pasta, `${planilha}.xlsx`))
    }
  }

  async function rodar(args: string[], deps: Record<string, unknown> = {}) {
    const out: string[] = []
    const err: string[] = []
    const estado = { conexoes: 0, storages: 0 }
    const codigo = await principal(args, {
      agora: AGORA,
      rng: rngDe(11),
      out: (s: string) => out.push(s),
      err: (s: string) => err.push(s),
      env: { IMPORT_DATABASE_URL: 'postgresql://u:p@db.exemplo.test:5432/postgres', IMPORT_SUPABASE_URL: 'https://x.exemplo.test', IMPORT_SUPABASE_SERVICE_ROLE_KEY: 'chave' },
      criarCliente: () => { estado.conexoes++; throw new Error('não deveria conectar') },
      criarStorage: () => { estado.storages++; throw new Error('não deveria usar Storage') },
      ...deps,
    })
    return { codigo, out: out.join('\n'), err: err.join('\n'), estado }
  }

  it('grava as planilhas, faz a ida e volta e não conecta em nada', async () => {
    const entrada = await temp()
    const base = await temp()
    const saida = path.join(base, 'nova', 'anon')
    await gravarFixture(entrada)
    const r = await rodar(['--anonimizar', '--backup', entrada, '--saida', saida])
    expect(r.err).toBe('')
    expect(r.codigo).toBe(0)
    expect(r.estado).toEqual({ conexoes: 0, storages: 0 })
    expect((await readdir(saida)).sort()).toEqual(Object.keys(COLUNAS).map((p) => `${p}.xlsx`).sort())

    const relida = await lerBackup(saida)
    const original = await lerBackup(entrada)
    expect(relatorioSemNomes(relida)).toEqual(relatorioSemNomes(original))
    expect(typeof relida.pacientes[0]['Data de nascimento']).toBe('number')
    expect(relida.pacientes[2]['Data de nascimento']).toBeInstanceOf(Date)

    expect(vazamentos(r.out)).toEqual([])
    expect(r.out).not.toContain(saida)
    expect(r.out).not.toContain(entrada)
    expect(r.out).toMatch(/pacientes: 4/)

    // Procura nos XML internos, inclusive metadados e colunas extras.
    for (const nome of await readdir(saida)) {
      const partes = unzipSync(new Uint8Array(await readFile(path.join(saida, nome))))
      const xml = Object.values(partes).map((u) => strFromU8(u)).join('\n')
      expect(vazamentos(xml), nome).toEqual([])
    }
  })

  it('não exige clínica nem profissional', async () => {
    const entrada = await temp()
    await gravarFixture(entrada)
    const r = await rodar(['--anonimizar', '--backup', entrada, '--saida', path.join(await temp(), 'x')])
    expect(r.codigo).toBe(0)
  })

  it.each([
    ['--gravar', ['--gravar']],
    ['--arquivos', ['--arquivos', 'a.zip']],
    ['--confirmar-clinica', ['--confirmar-clinica', '11111111-1111-4111-8111-111111111111']],
    ['--permitir-existentes', ['--permitir-existentes']],
    ['--permitir-novos', ['--permitir-novos']],
  ])('não combina com %s', async (_nome, extra) => {
    let leu = 0
    const r = await rodar(['--anonimizar', '--backup', await temp(), '--saida', path.join(await temp(), 'x'), ...extra], {
      lerBackup: async () => { leu++; return {} },
    })
    expect(r.codigo).toBe(1)
    expect(r.err).toMatch(/--anonimizar/)
    expect(leu).toBe(0)
  })

  it('recusa --saida dentro do repositório', async () => {
    const r = await rodar(['--anonimizar', '--backup', await temp(), '--saida', path.join(REPO, 'saida-anon-teste')])
    expect(r.codigo).toBe(1)
    expect(r.err).toMatch(/repositório/)
  })

  it('recusa --saida igual ou dentro de --backup', async () => {
    const entrada = await temp()
    for (const saida of [entrada, path.join(entrada, 'sub')]) {
      const r = await rodar(['--anonimizar', '--backup', entrada, '--saida', saida])
      expect(r.codigo).toBe(1)
      expect(r.err).toMatch(/--backup/)
    }
    expect(await readdir(entrada)).toEqual([])
  })

  it('recusa pasta de saída com conteúdo, sem tocar nela', async () => {
    const entrada = await temp()
    const saida = await temp()
    await gravarFixture(entrada)
    await writeFile(path.join(saida, 'existente.txt'), 'manter')
    const r = await rodar(['--anonimizar', '--backup', entrada, '--saida', saida])
    expect(r.codigo).toBe(1)
    expect(r.err).toMatch(/vazia/)
    expect(await readdir(saida)).toEqual(['existente.txt'])
  })

  it('aceita pasta de saída vazia e recusa quando a saída é um arquivo', async () => {
    const entrada = await temp()
    await gravarFixture(entrada)
    const vazia = await temp()
    expect((await rodar(['--anonimizar', '--backup', entrada, '--saida', vazia])).codigo).toBe(0)
    const arquivo = path.join(await temp(), 'arquivo')
    await writeFile(arquivo, 'x')
    const r = await rodar(['--anonimizar', '--backup', entrada, '--saida', arquivo])
    expect(r.codigo).toBe(1)
    expect(r.err).not.toContain(arquivo)
  })

  it('não deixa arquivos se a conferência final divergir', async () => {
    const entrada = await temp()
    const saida = path.join(await temp(), 'anon')
    await gravarFixture(entrada)
    let chamadas = 0
    const r = await rodar(['--anonimizar', '--backup', entrada, '--saida', saida], {
      lerBackup: async (p: string) => {
        const b = await lerBackup(p)
        if (++chamadas === 2) b.pacientes.pop()
        return b
      },
    })
    expect(r.codigo).toBe(1)
    expect(r.err).toMatch(/conferência/i)
    expect(await readdir(saida)).toEqual([])
  })

  it('erro de leitura não expõe caminhos', async () => {
    const base = await temp()
    const entrada = path.join(base, 'nao-existe-backup')
    await mkdir(path.join(base, 'x'))
    const r = await rodar(['--anonimizar', '--backup', entrada, '--saida', path.join(base, 'y')])
    expect(r.codigo).toBe(1)
    expect(r.err).not.toContain(entrada)
  })
})
