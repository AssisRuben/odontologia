import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { INDICE, PARTES } from '@/content/ajuda/indice'
import { imagensCitadas, linksInternos, lerCapitulo, lerGeracao } from '@/lib/ajuda/manual'

const DIR_MD = path.join(process.cwd(), 'src/content/ajuda')
const DIR_IMG = path.join(process.cwd(), 'public/ajuda/img')

describe('imagensCitadas', () => {
  it('pega só as imagens de /ajuda/img/', () => {
    const md = 'a ![x](/ajuda/img/agenda-semana.png) b ![y](/ajuda/img/b.png) c ![z](/outra/c.png)'
    expect(imagensCitadas(md)).toEqual(['/ajuda/img/agenda-semana.png', '/ajuda/img/b.png'])
  })
})

describe('linksInternos', () => {
  it('pega só os links #slug', () => {
    expect(linksInternos('veja [Prof](#profissionais) e [site](https://x.com)')).toEqual(['profissionais'])
  })
})

describe('lerCapitulo', () => {
  it('devolve null quando o arquivo não existe', () => {
    expect(lerCapitulo('nao-existe')).toBeNull()
  })
})

describe('lerGeracao', () => {
  let tmp: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ajuda-'))
    fs.mkdirSync(path.join(tmp, 'ajuda'))
  })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('sem arquivos: sem data e sem PDF', () => {
    expect(lerGeracao(tmp)).toEqual({ data: null, temPdf: false })
  })
  it('com gerado.json e PDF: data em dd/MM/yyyy', () => {
    fs.writeFileSync(path.join(tmp, 'ajuda/gerado.json'), '{"data":"2026-11-10"}')
    fs.writeFileSync(path.join(tmp, 'ajuda/manual.pdf'), '%PDF')
    expect(lerGeracao(tmp)).toEqual({ data: '10/11/2026', temPdf: true })
  })
  it('JSON inválido: sem data', () => {
    fs.writeFileSync(path.join(tmp, 'ajuda/gerado.json'), 'xx')
    expect(lerGeracao(tmp).data).toBeNull()
  })
})

describe('consistência do manual', () => {
  const slugs = INDICE.map(c => c.slug)
  const arquivos = fs.readdirSync(DIR_MD).filter(f => f.endsWith('.md'))

  it('tem 21 capítulos com slugs únicos e válidos', () => {
    expect(INDICE).toHaveLength(21)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9-]+$/)
  })
  it('toda parte do índice existe em PARTES', () => {
    for (const c of INDICE) expect(PARTES).toContain(c.parte)
  })
  it('todo capítulo tem arquivo e não sobra arquivo fora do índice', () => {
    for (const s of slugs) expect(arquivos, s).toContain(`${s}.md`)
    for (const f of arquivos) expect(slugs, f).toContain(f.replace(/\.md$/, ''))
  })
  it('imagens citadas existem, links apontam para capítulos e não há título #', () => {
    for (const s of slugs) {
      const md = lerCapitulo(s) ?? ''
      for (const img of imagensCitadas(md)) {
        expect(fs.existsSync(path.join(DIR_IMG, path.basename(img))), `${s}: ${img}`).toBe(true)
      }
      for (const l of linksInternos(md)) expect(slugs, `${s}: #${l}`).toContain(l)
      expect(md.startsWith('# '), s).toBe(false)
    }
  })
})
