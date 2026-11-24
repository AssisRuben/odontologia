import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { strToU8, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  COLUNAS, dataYmd, digitos, dinheiro, inteiroOuNulo, instanteSP, lerBackup, simNao,
} from '../../scripts/importar-codental/ler.mjs'

const onde = { planilha: 'teste', coluna: 'Coluna', linha: 7 }
let pasta: string

async function gravar(nome: string, cabecalho: string[], linhas: unknown[][] = []) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Planilha')
  ws.addRow(cabecalho)
  for (const l of linhas) ws.addRow(l)
  await wb.xlsx.writeFile(path.join(pasta, `${nome}.xlsx`))
}

async function gravarTodas(exceto?: string) {
  for (const [nome, colunas] of Object.entries(COLUNAS)) {
    if (nome !== exceto) await gravar(nome, colunas as string[])
  }
}

// Arquivo mínimo com strings inline (t="inlineStr"), como no export original.
async function gravarInline(nome: string, cabecalho: string[], linha: string[]) {
  const col = (i: number) => {
    let s = ''
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
    return s
  }
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const celulas = (vs: string[], r: number) => vs
    .map((v, i) => `<c r="${col(i)}${r}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join('')
  const xml = '<?xml version="1.0" encoding="UTF-8"?>'
  const zip = zipSync({
    '[Content_Types].xml': strToU8(`${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    '_rels/.rels': strToU8(`${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`${xml}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Planilha" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    'xl/worksheets/sheet1.xml': strToU8(`${xml}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${celulas(cabecalho, 1)}</row><row r="2">${celulas(linha, 2)}</row></sheetData></worksheet>`),
  })
  await writeFile(path.join(pasta, `${nome}.xlsx`), zip)
}

beforeEach(async () => { pasta = await mkdtemp(path.join(tmpdir(), 'codental-teste-')) })
afterEach(async () => { await rm(pasta, { recursive: true, force: true }) })

describe('lerBackup', () => {
  it('lê as linhas por cabeçalho normalizado, com o número da linha', async () => {
    await gravarTodas('profissionais')
    const cab = COLUNAS.profissionais.map((c: string) => `  ${c.normalize('NFD')} `)
    await gravar('profissionais', [...cab, 'Coluna extra'], [
      ['10', 'usuario.teste', 'Dra. Fictícia', null, null, null, null, null, null, 'ignorar'],
      [],
      ['11', 'outro.teste', 'Dr. Inventado'],
    ])
    const backup = await lerBackup(pasta)
    expect(backup.profissionais).toHaveLength(2)
    expect(backup.profissionais[0].Nome).toBe('Dra. Fictícia')
    expect(backup.profissionais[0]._linha).toBe(2)
    expect(backup.profissionais[1]._linha).toBe(4)
    expect(backup.profissionais[0]).not.toHaveProperty('Coluna extra')
  })

  it('lê strings inline', async () => {
    await gravarTodas('profissionais')
    const cab = COLUNAS.profissionais as string[]
    await gravarInline('profissionais', cab, cab.map((_, i) => (i === 2 ? 'Dra. Inline Fictícia' : `v${i}`)))
    const backup = await lerBackup(pasta)
    expect(backup.profissionais[0].Nome).toBe('Dra. Inline Fictícia')
  })

  it('coluna obrigatória ausente: erro com planilha e coluna, sem valores', async () => {
    await gravarTodas('consultas')
    const cab = COLUNAS.consultas.filter((c: string) => c !== 'Duração')
    await gravar('consultas', cab, [['VALOR-SECRETO']])
    const erro = await lerBackup(pasta).catch((e: Error) => e)
    expect(erro).toBeInstanceOf(Error)
    expect((erro as Error).message).toContain('consultas')
    expect((erro as Error).message).toContain('Duração')
    expect((erro as Error).message).not.toContain('VALOR-SECRETO')
  })

  it('planilha ausente: erro com o nome dela', async () => {
    await gravarTodas('tratamentos')
    await expect(lerBackup(pasta)).rejects.toThrow('tratamentos')
  })
})

describe('normalização de células', () => {
  it('datas em texto, com separador e segundos opcionais', () => {
    expect(instanteSP('05/01/2026 09:00', onde)).toBe('2026-01-05T12:00:00.000Z')
    expect(instanteSP('05/01/2026 - 09:00:30', onde)).toBe('2026-01-05T12:00:30.000Z')
    expect(instanteSP('05/01/2026', onde)).toBe('2026-01-05T03:00:00.000Z')
    expect(dataYmd('05/01/2026 23:59', onde)).toBe('2026-01-05')
  })

  it('serial Excel e Date não deslocam o dia', () => {
    expect(dataYmd(45000, onde)).toBe('2023-03-15')
    expect(dataYmd(new Date(Date.UTC(2023, 2, 15)), onde)).toBe('2023-03-15')
    expect(instanteSP(new Date(Date.UTC(2026, 0, 5, 9, 0)), onde)).toBe('2026-01-05T12:00:00.000Z')
    expect(instanteSP(45000.5, onde)).toBe('2023-03-15T15:00:00.000Z')
  })

  it('data inválida: erro com a posição, sem o valor', () => {
    for (const v of ['31/02/2026', '2026-01-05', 'amanhã']) {
      expect(() => dataYmd(v, onde)).toThrow(/teste.*Coluna.*7/)
      try { dataYmd(v, onde) } catch (e) { expect((e as Error).message).not.toContain(v) }
    }
  })

  it('dinheiro', () => {
    expect(dinheiro('R$ 1.234,56', onde)).toBe(1234.56)
    expect(dinheiro('R$ 1.234.567,5', onde)).toBe(1234567.5)
    expect(dinheiro('R$ 0,00', onde)).toBe(0)
    expect(dinheiro(10.5, onde)).toBe(10.5)
    expect(dinheiro(null, onde)).toBeNull()
    expect(() => dinheiro('abc', onde)).toThrow(/linha 7/)
  })

  it('dígitos, inteiros e Sim/Não', () => {
    expect(digitos('529.982.247-25')).toBe('52998224725')
    expect(digitos('---')).toBeNull()
    expect(inteiroOuNulo('-', onde)).toBeNull()
    expect(inteiroOuNulo(3, onde)).toBe(3)
    expect(inteiroOuNulo('12', onde)).toBe(12)
    expect(() => inteiroOuNulo('1,5', onde)).toThrow(/linha 7/)
    expect(simNao('Sim', onde)).toBe(true)
    expect(simNao('Não', onde)).toBe(false)
    expect(() => simNao('Talvez', onde)).toThrow(/linha 7/)
  })
})

describe('lerBackup: célula de erro do Excel', () => {
  it.each([
    ['erro direto', { error: '#N/A' }],
    ['fórmula com erro', { formula: 'A1/0', result: { error: '#DIV/0!' } }],
  ])('%s aborta com planilha, coluna e linha, sem o valor', async (_nome, celula) => {
    await gravarTodas('profissionais')
    await gravar('profissionais', COLUNAS.profissionais as string[], [['10', 'usuario', celula]])
    let msg = ''
    try { await lerBackup(pasta) } catch (e) { msg = (e as Error).message }
    expect(msg).toMatch(/Planilha profissionais, coluna Nome, linha 2/)
    expect(msg).not.toMatch(/#N\/A|#DIV/)
  })
})
