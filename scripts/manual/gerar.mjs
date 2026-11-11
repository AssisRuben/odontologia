// npm run manual — tira as capturas do manual e gera public/ajuda/manual.pdf.
// Pré-requisitos e passo a passo: README, seção "Manual do sistema".

import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { lerAmbiente, verificarLogin, resumir } from './util.mjs'
import { CAPTURAS } from './capturas.mjs'

const RAIZ = path.resolve(import.meta.dirname, '../..')
const DIR_AJUDA = path.join(RAIZ, 'public/ajuda')
const DIR_IMG = path.join(DIR_AJUDA, 'img')
const ESPERA = 15_000
// Esconde o cursor de texto e o indicador do Next em modo dev (nextjs-portal).
const CSS_LIMPO = '*{caret-color:transparent !important} nextjs-portal{display:none !important}'

const CONTEXTO = {
  viewport: { width: 1280, height: 800 },
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
  colorScheme: 'light',
}

function falhar(msg) {
  console.error(`\n✖ ${msg}\n`)
  process.exit(1)
}

function hojeSaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}

async function entrar(browser, { url, email, senha }) {
  const ctx = await browser.newContext(CONTEXTO)
  const page = await ctx.newPage()
  await page.goto(`${url}/login`)
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(senha)
  await page.locator('button[type=submit]').click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: ESPERA }).catch(() => {})
  verificarLogin(page.url())
  const sessao = await ctx.storageState()
  await ctx.close()
  return sessao
}

async function capturar(browser, url, sessao, c) {
  const ctx = await browser.newContext({ ...CONTEXTO, ...(c.semLogin ? {} : { storageState: sessao }) })
  ctx.setDefaultTimeout(ESPERA)
  const page = await ctx.newPage()
  try {
    await page.goto(`${url}${c.url}`)
    await page.waitForLoadState('networkidle', { timeout: ESPERA }).catch(() => {})
    if (c.passos) await c.passos(page)
    for (const [seletor, valor] of Object.entries(c.falsos ?? {})) await page.locator(seletor).fill(valor)
    await page.addStyleTag({ content: CSS_LIMPO })
    await page.waitForTimeout(300)
    const destino = path.join(DIR_IMG, `${c.arquivo}.png`)
    const tmp = `${destino}.tmp.png`
    await page.screenshot({ path: tmp, fullPage: !!c.fullPage })
    fs.renameSync(tmp, destino)
    return { arquivo: c.arquivo }
  } catch (e) {
    return { arquivo: c.arquivo, erro: String(e?.message ?? e).split('\n')[0] }
  } finally {
    await ctx.close()
  }
}

async function gerarPdf(browser, url, sessao) {
  const ctx = await browser.newContext({ ...CONTEXTO, storageState: sessao })
  const page = await ctx.newPage()
  await page.goto(`${url}/ajuda`, { waitUntil: 'networkidle' })
  // Imagens "lazy" só carregam ao rolar: força todas antes de imprimir.
  await page.evaluate(async () => {
    const imgs = [...document.images]
    imgs.forEach(i => { i.loading = 'eager' })
    await Promise.all(imgs.map(i => i.complete && i.naturalWidth > 0
      ? null
      : new Promise(ok => { i.onload = ok; i.onerror = ok })))
  })
  const quebradas = await page.evaluate(() => [...document.images].filter(i => !i.naturalWidth).map(i => i.src))
  if (quebradas.length) throw new Error(`Imagens que não carregaram no PDF:\n${quebradas.join('\n')}`)
  await page.addStyleTag({ content: CSS_LIMPO })
  await page.emulateMedia({ media: 'print' })
  const destino = path.join(DIR_AJUDA, 'manual.pdf')
  await page.pdf({
    path: destino,
    format: 'A4',
    printBackground: true,
    margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;text-align:center;font-size:9px;color:#8A989E"><span class="pageNumber"></span></div>',
  })
  await ctx.close()
  return destino
}

async function main() {
  let amb
  try { amb = lerAmbiente(process.env) } catch (e) { falhar(e.message) }

  try { await fetch(amb.url) } catch { falhar(`O app não respondeu em ${amb.url} — rode npm run dev`) }

  fs.mkdirSync(DIR_IMG, { recursive: true })
  const browser = await chromium.launch()
  try {
    let sessao
    try { sessao = await entrar(browser, amb) } catch (e) { falhar(e.message) }

    const resultados = []
    for (const c of CAPTURAS) {
      const r = await capturar(browser, amb.url, sessao, c)
      console.log(r.erro ? `  ✖ ${r.arquivo}` : `  ✓ ${r.arquivo}`)
      resultados.push(r)
    }
    const { texto, falhou } = resumir(resultados)
    console.log(`\n${texto}`)
    if (falhou) falhar('Corrija as capturas que falharam; o PDF não foi gerado.')

    fs.writeFileSync(path.join(DIR_AJUDA, 'gerado.json'), JSON.stringify({ data: hojeSaoPaulo() }) + '\n')
    const pdf = await gerarPdf(browser, amb.url, sessao)
    console.log(`\nPDF gerado: ${path.relative(RAIZ, pdf)}`)
  } finally {
    await browser.close()
  }
}

main()
