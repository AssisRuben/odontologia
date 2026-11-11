import fs from 'node:fs'
import path from 'node:path'

const DIR_CONTEUDO = path.join(process.cwd(), 'src/content/ajuda')
const DIR_PUBLIC = path.join(process.cwd(), 'public')

/** Caminhos das imagens do manual citadas no Markdown (só as de /ajuda/img/). */
export function imagensCitadas(md: string): string[] {
  return [...md.matchAll(/!\[[^\]]*\]\((\/ajuda\/img\/[^)\s]+)\)/g)].map(m => m[1])
}

/** Slugs dos links internos [texto](#slug). */
export function linksInternos(md: string): string[] {
  return [...md.matchAll(/\]\(#([^)\s]+)\)/g)].map(m => m[1])
}

/** Texto do capítulo, ou null se o arquivo não existe. */
export function lerCapitulo(slug: string, dir = DIR_CONTEUDO): string | null {
  const arquivo = path.join(dir, `${slug}.md`)
  return fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8') : null
}

/** Data da última geração (dd/MM/yyyy) e se o PDF existe. */
export function lerGeracao(publicDir = DIR_PUBLIC): { data: string | null; temPdf: boolean } {
  const temPdf = fs.existsSync(path.join(publicDir, 'ajuda/manual.pdf'))
  let data: string | null = null
  try {
    const bruto = JSON.parse(fs.readFileSync(path.join(publicDir, 'ajuda/gerado.json'), 'utf8'))
    const m = typeof bruto?.data === 'string' ? bruto.data.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null
    if (m) data = `${m[3]}/${m[2]}/${m[1]}`
  } catch {
    // arquivo ausente ou inválido: sem data
  }
  return { data, temPdf }
}
