# Manual do sistema (Ajuda) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Página `/ajuda` com o manual completo (21 capítulos em Markdown, capturas reais) e `npm run manual`, que tira as capturas do app rodando e gera `public/ajuda/manual.pdf` a partir da própria página.

**Architecture:** Textos em `src/content/ajuda/*.md` ordenados por `indice.ts`; funções puras em `src/lib/ajuda/` leem e validam os arquivos; a página é um componente de servidor que renderiza com `react-markdown`, com índice lateral client-side e CSS de impressão (capa + sumário). Um script Node com Playwright faz login numa conta demo, congela o relógio na data do seed, fotografa cada tela e imprime `/ajuda` em PDF.

**Tech Stack:** Next.js 16.2.6 (App Router, sem `cacheComponents`), React 19, Tailwind v4 com tokens do novo layout, `react-markdown` + `remark-gfm`, Playwright (dev), vitest.

**Spec:** `docs/superpowers/specs/2026-11-10-manual-ajuda-design.md`

## Global Constraints

- Ler o guia relevante em `node_modules/next/dist/docs/` antes de escrever páginas (AGENTS.md) — em especial `01-app/01-getting-started/05-server-and-client-components.md`.
- Tudo em português; textos para recepcionista/dentista, sem termos técnicos; nomes de botões/abas **em negrito**, exatamente como na tela.
- Cada passo do manual é conferido no código da tela antes de ser escrito; nada é descrito sem existir.
- Capítulo começa em `##`; o título (`#`) vem do `indice.ts`. Modelo: "Para que serve" → "Antes de começar" (se houver) → uma seção por tarefa com passos numerados e imagem → "Dúvidas comuns" (se houver).
- Slugs: só `[a-z0-9-]`. Imagens: `/ajuda/img/<slug>-<tarefa>.png`.
- Cores só por tokens (`tinta*`, `linha*`, `porcelana*`, `petroleo*`, `gengiva*`).
- Capturas: 1280×800, `pt-BR`, fuso `America/Sao_Paulo`, relógio real (dados do `npm run demo` em volta de hoje); paciente da ficha = `Maria Silva Santos`. Timeout por captura 15 s. Nunca clicar em "Salvar"/"Excluir"/"Enviar" nos `passos`.
- Valores falsos de chave: OpenAI `sk-demo-0000000000000000`; demais chaves `demo-0000000000`.
- Env do script: `MANUAL_URL` (padrão `http://localhost:3000`), `MANUAL_EMAIL`, `MANUAL_SENHA`.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. vitest no Windows: rodar a partir de `C:\Workspace\odontologia` (C maiúsculo).

## Review Focus

- **Login falha (senha errada, conta inexistente):** o script deve parar logo com "Não consegui entrar com MANUAL_EMAIL — confira e-mail e senha", não registrar 40 falhas de captura. → teste em Task 3 (`verificarLogin`).
- **Imagens `lazy` no PDF:** sem forçar o carregamento, o PDF sai com quadros em branco. → Task 3 troca `loading` para `eager` e espera todo `img.complete && naturalWidth > 0` antes do `page.pdf`; verificação manual na Task 4.
- **Relógio congelado quebrando o login:** logar com o relógio real e só então chamar `page.clock.setFixedTime(DATA_DEMO)`; a página do PDF usa um contexto sem relógio congelado. → ordem fixada na Task 3.
- **Capítulo/imagem renomeado de um lado só:** o teste de consistência pega antes da main. → Task 1.
- **Impressão mostrando menu, banner ou o recuo de 220 px do layout:** `print:hidden` no `Navbar` e `WhatsAppBanner`, `print:p-0` no `<main>` do layout do dashboard. → Task 2, verificação manual na Task 4.

---

### Task 1: Índice, leitura dos capítulos e teste de consistência

**Files:**
- Create: `src/content/ajuda/indice.ts`
- Create: `src/content/ajuda/<slug>.md` × 21 (stub: `## Para que serve\n\nEm preparação.\n`)
- Create: `src/lib/ajuda/manual.ts`
- Test: `tests/ajuda/manual.test.ts`

**Interfaces:**
- Produces:
  - `type Parte = 'Começando' | 'Configuração inicial' | 'Dia a dia' | 'Gestão'`
  - `type Capitulo = { parte: Parte; slug: string; titulo: string }`
  - `INDICE: Capitulo[]` (21 entradas, slugs e títulos da tabela do spec, na ordem do spec)
  - `PARTES: Parte[]` (as 4, na ordem)
  - `imagensCitadas(md: string): string[]` — caminhos de `![..](/ajuda/img/...)`
  - `linksInternos(md: string): string[]` — slugs de `[..](#slug)`
  - `lerCapitulo(slug: string, dir?: string): string | null` — conteúdo do `.md` ou `null` se não existir; `dir` padrão `path.join(process.cwd(), 'src/content/ajuda')`
  - `lerGeracao(publicDir?: string): { data: string | null; temPdf: boolean }` — lê `public/ajuda/gerado.json` (`data` formatada `dd/MM/yyyy`; `null` se ausente ou inválido) e verifica `public/ajuda/manual.pdf`

- [ ] **Step 1: Write the failing tests** em `tests/ajuda/manual.test.ts`:
  - `imagensCitadas('a ![x](/ajuda/img/agenda-semana.png) b ![y](/ajuda/img/b.png)')` → `['/ajuda/img/agenda-semana.png', '/ajuda/img/b.png']`; ignora imagens fora de `/ajuda/img/`.
  - `linksInternos('veja [Prof](#profissionais) e [site](https://x.com)')` → `['profissionais']`.
  - `lerCapitulo('nao-existe')` → `null`.
  - `lerGeracao(tmpDir)`: sem arquivos → `{ data: null, temPdf: false }`; com `gerado.json` `{"data":"2026-11-10"}` e `manual.pdf` → `{ data: '10/11/2026', temPdf: true }`; JSON inválido → `data: null`.
  - Consistência sobre os arquivos reais: `INDICE.length === 21`; slugs únicos e `/^[a-z0-9-]+$/`; todo slug tem `.md`; nenhum `.md` em `src/content/ajuda/` fora do índice; toda imagem citada existe em `public/ajuda/img/`; todo link interno é slug do índice; nenhum `.md` começa com `# `; toda `parte` está em `PARTES`.
- [ ] **Step 2:** `npx vitest run tests/ajuda` → FAIL (módulos não existem).
- [ ] **Step 3:** Implementar `indice.ts`, os 21 stubs e `manual.ts` (`fs.readFileSync`/`existsSync`, regex simples).
- [ ] **Step 4:** `npx vitest run tests/ajuda` → PASS; `npm test` → tudo verde.
- [ ] **Step 5: Commit** `feat(ajuda): índice e leitura dos capítulos do manual`

### Task 2: Página `/ajuda`, item no menu e CSS de impressão

**Files:**
- Modify: `package.json` (deps `react-markdown`, `remark-gfm`)
- Create: `src/app/(dashboard)/ajuda/page.tsx` (servidor)
- Create: `src/components/ajuda/ConteudoMarkdown.tsx` (servidor; mapeia `h2,h3,p,ol,ul,li,a,img,table,th,td,strong,code` para classes com tokens)
- Create: `src/components/ajuda/IndiceManual.tsx` (`'use client'`; coluna fixa no `md:`, botão "Índice" no celular, destaque via IntersectionObserver)
- Create: `src/components/ajuda/CapaImpressao.tsx` (servidor; `hidden print:block`: `LogoDente`, "Manual do sistema", data, sumário por parte)
- Modify: `src/components/layout/Navbar.tsx:20-29` (item `{ label: 'Ajuda', href: '/ajuda', icon: HelpCircle }` depois de Configurações; raiz do componente com `print:hidden`)
- Modify: `src/app/(dashboard)/layout.tsx` (`<main>` com `print:p-0`; `WhatsAppBanner` envolvido em `print:hidden`)

**Interfaces:**
- Consumes: `INDICE`, `PARTES`, `lerCapitulo`, `lerGeracao` (Task 1).
- Produces: estrutura do DOM usada pelo script (Task 3): cada capítulo é `<section id="<slug>" data-capitulo>`; o botão "Baixar PDF" e o índice têm `print:hidden`; imagens são `<img loading="lazy">`.

- [ ] **Step 1:** `npm i react-markdown remark-gfm`.
- [ ] **Step 2:** Implementar a página: topo com "Manual do sistema", "Atualizado em {data}" (só se `data`), botão "Baixar PDF" (`<a href="/ajuda/manual.pdf" target="_blank">`, só se `temPdf`); capítulos agrupados por parte (`<h2>` da parte, `<h1>`/título do capítulo do índice); `.md` ausente → parágrafo "Capítulo em preparação.". Imagem: `<figure className="break-inside-avoid">` com `<img>` (`eslint-disable-next-line @next/next/no-img-element`), borda `linha`, sombra leve, `<figcaption>` com o `alt`. Cada `<section>` com `print:break-before-page`.
- [ ] **Step 3:** `npm run lint` e `npm run build` → sem erros; `/ajuda` aparece como rota estática.
- [ ] **Step 4: Verificar no navegador** (`npm run dev`, logado): item "Ajuda" no menu lateral e na gaveta "Mais" (celular); 21 capítulos com "Em preparação."; clicar no índice rola até o capítulo e o destaque acompanha a rolagem; Ctrl+P mostra capa + sumário, sem menu, banner, índice ou botão, cada capítulo em página nova.
- [ ] **Step 5: Commit** `feat(ajuda): página do manual com índice e impressão`

### Task 3: Script `npm run manual` (capturas + PDF)

**Files:**
- Modify: `package.json` (devDep `playwright`; script `"manual": "node --env-file=.env.local scripts/manual/gerar.mjs"`)
- Create: `scripts/manual/util.mjs`
- Create: `scripts/manual/capturas.mjs`
- Create: `scripts/manual/gerar.mjs`
- Modify: `.env.example` (`MANUAL_URL`, `MANUAL_EMAIL`, `MANUAL_SENHA` vazios, com comentário)
- Modify: `README.md` (seção "Manual do sistema": pré-requisitos 1–4 do spec e o comando)
- Test: `tests/ajuda/util.test.ts`

**Interfaces:**
- Produces:
  - `util.mjs`: `lerAmbiente(env): { url: string; email: string; senha: string }` — lança `Error('Defina MANUAL_EMAIL e MANUAL_SENHA no .env.local (conta de demonstração)')` se faltar; `url` sem `/` no fim, padrão `http://localhost:3000`.
  - `util.mjs`: `verificarLogin(urlFinal: string): void` — lança `Error('Não consegui entrar com MANUAL_EMAIL — confira e-mail e senha')` se `urlFinal` contém `/login`.
  - `util.mjs`: `resumir(resultados: { arquivo: string; erro?: string }[]): { texto: string; falhou: boolean }` — texto `"{n} capturas ok, {m} falharam"` + uma linha `- {arquivo}: {erro}` por falha.
  - `capturas.mjs`: `export const DATA_DEMO`, `export const PACIENTE_DEMO`, `export const CAPTURAS: { arquivo: string; url: string; passos?: (page) => Promise<void>; falsos?: Record<string, string>; fullPage?: boolean; semLogin?: boolean }[]` — `semLogin: true` = captura num contexto deslogado (ex.: tela de login); começa vazia; Tasks 4–8 acrescentam.

- [ ] **Step 1: Write the failing tests** (`tests/ajuda/util.test.ts`, importando `../../scripts/manual/util.mjs`):
  - `lerAmbiente({})` lança a mensagem exata; `lerAmbiente({ MANUAL_EMAIL: 'a', MANUAL_SENHA: 'b' })` → `{ url: 'http://localhost:3000', email: 'a', senha: 'b' }`; `MANUAL_URL: 'http://x:4000/'` → `url: 'http://x:4000'`.
  - `verificarLogin('http://localhost:3000/login?x')` lança a mensagem exata; `verificarLogin('http://localhost:3000/agenda')` não lança.
  - `resumir([{arquivo:'a'},{arquivo:'b',erro:'timeout'}])` → `{ texto: '1 capturas ok, 1 falharam\n- b: timeout', falhou: true }`; sem falhas → `falhou: false`.
- [ ] **Step 2:** `npx vitest run tests/ajuda/util.test.ts` → FAIL.
- [ ] **Step 3:** Implementar `util.mjs` → Step 2 passa.
- [ ] **Step 4:** `npm i -D playwright` e implementar `gerar.mjs`, nesta ordem:
  1. `lerAmbiente(process.env)`; `fetch(url)` — se falhar, sair com "O app não respondeu em {url} — rode npm run dev".
  2. Chromium, contexto `{ viewport: 1280×800, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', colorScheme: 'light' }`.
  3. Login com relógio real: `/login`, preencher `input[type=email]`/`input[type=password]`, clicar `button[type=submit]`, esperar sair de `/login` (15 s) e `verificarLogin(page.url())`.
  4. `page.clock.setFixedTime(new Date(DATA_DEMO))`.
  5. Para cada captura, em `try/catch` isolado (as com `semLogin` usam um contexto separado sem sessão): `goto(url + c.url)`, `waitForLoadState('networkidle')`, `passos`, preencher `falsos` (`locator(sel).fill(valor)`), CSS que esconde caret (`caret-color: transparent`), `screenshot({ path: public/ajuda/img/{arquivo}.png, fullPage })` — escrever num `.tmp` e renomear só no sucesso.
  6. Imprimir `resumir(...)`; se `falhou`, `process.exit(1)` sem gerar PDF.
  7. Gravar `public/ajuda/gerado.json` com `{ data: todayYmd(new Date(), 'America/Sao_Paulo') }` (de `src/lib/messaging/time` — se importar `.ts` do script não funcionar, usar `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })`).
  8. Novo contexto **sem** relógio congelado, reaproveitando `storageState` do login; `goto('/ajuda')`; `img` → `loading = 'eager'`; esperar todas `complete && naturalWidth > 0`; `emulateMedia({ media: 'print' })`; `page.pdf({ path: 'public/ajuda/manual.pdf', format: 'A4', printBackground: true, margin: 15mm em todos os lados, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: número da página centralizado, 9px })`.
  9. Imprimir caminho do PDF; fechar navegador.
- [ ] **Step 5:** Atualizar `.env.example` e `README.md`.
- [ ] **Step 6: Verificar:** com `MANUAL_SENHA` errada → para com a mensagem de login; sem o app rodando → para com a mensagem de app; com tudo certo e `CAPTURAS` vazia → "0 capturas ok, 0 falharam", gera `gerado.json` e `manual.pdf` (capa + sumário + 21 capítulos "Em preparação.").
- [ ] **Step 7: Commit** `feat(ajuda): script npm run manual com capturas e PDF`

### Task 3b: Dados de demonstração (`npm run demo`)

Acrescentada em 2026-11-11 (spec, seção "Dados de demonstração").

**Files:**
- Create: `scripts/demo/env.mjs` — `atualizarEnv(texto: string, valores: Record<string,string>): string` (troca a linha `CHAVE=` existente, comentada ou não, ou acrescenta no fim; preserva as demais e o fim de linha)
- Create: `scripts/demo/dados.mjs` — `montarDados(ctx): Demo` puro; `ctx = { hoje: 'YYYY-MM-DD', clinicId, donoId (professional do login), userId, uid: () => string, tuss: {code,name}[], glosa: string | null, perguntas: {id,type}[] }`; `Demo` = `{ insercoes: [tabela, linhas[]][] (em ordem de dependência), clinica: patch, dono: patch, orcamentos: {id, acao: 'rascunho'|'enviar'|'ver'|'aprovar'|'perder', ...}[], recorrencias: p_data[], lote: {id, itemIds, protocolo, enviadoEm, pagoEm, deposito, itens: p_items}, pularMaterial: treatmentId[] }`; também `cpfValido(base9: string): string`
- Create: `scripts/demo/rodar.mjs` — conta, trava da clínica, limpeza, inserções, RPCs, `.env.local`
- Modify: `package.json` (`"demo"`), `README.md` (seção Manual: `npm run demo` no lugar da conta de teste)
- Modify: `scripts/manual/capturas.mjs`, `scripts/manual/gerar.mjs` (sem `DATA_DEMO`/relógio; `PACIENTE_DEMO` vira o nome `'Maria Silva Santos'`)
- Test: `tests/demo/env.test.ts`, `tests/demo/dados.test.ts`

- [ ] **Step 1:** testes falhando: `atualizarEnv` (troca, acrescenta, preserva outras linhas e `
`); `cpfValido` (dígitos verificadores corretos); `montarDados` com `hoje='2026-11-11'` — toda FK (`patient_id`, `professional_id`, `appointment_id`, `insurance_plan_id`, `guide_id`, `item_id`, `kit_id`, `laboratory_id`, `prosthetic_id`, `conversation_id`, `budget_id`, `treatment_id`) aponta para id criado antes na ordem de `insercoes` (ou `donoId`); 7 status de consulta presentes; consultas entre segunda da semana passada e sábado da próxima, nenhuma no domingo; um paciente com aniversário em `11-11`; tudo com `clinic_id` da clínica (onde a coluna existe); `quantity` de item com validade = soma dos lotes.
- [ ] **Step 2:** `npx vitest run tests/demo` → FAIL.
- [ ] **Step 3:** implementar `env.mjs` e `dados.mjs` → PASS.
- [ ] **Step 4:** implementar `rodar.mjs`; ajustar capturas/gerar/README/package.json.
- [ ] **Step 5:** `npm run demo` duas vezes seguidas → as duas terminam sem erro; `.env.local` com `MANUAL_EMAIL=demo@manual.local`; nenhuma outra clínica alterada (contagem de `patients` fora da clínica demo igual antes/depois).
- [ ] **Step 6: Commit** `feat(demo): npm run demo com dados de demonstração completos`

### Task 4: Capítulos-piloto (acesso, clinica, agenda) — validar o visual com o usuário

**Files:**
- Modify: `src/content/ajuda/acesso.md`, `clinica.md`, `agenda.md`
- Modify: `scripts/manual/capturas.mjs`
- Create: `public/ajuda/img/*.png`, `public/ajuda/gerado.json`, `public/ajuda/manual.pdf`

**Interfaces:**
- Consumes: `CAPTURAS` (Task 3), modelo de capítulo (Global Constraints).

- [ ] **Step 1:** Ler o código de `src/app/(auth)/login`, `(auth)/register`, `src/components/layout/*` (menu, `BuscaRapida`, `SinoPendencias`, `MenuUsuario`), `configuracoes/clinica/page.tsx` e `agenda/page.tsx` + `src/components/agenda/*`; listar as tarefas principais de cada tela.
- [ ] **Step 2:** Escrever os 3 capítulos seguindo o modelo; cada imagem citada ganha uma entrada em `CAPTURAS` (ex.: `acesso-login` em `/login` com `semLogin: true`; `agenda-semana` em `/agenda`; `agenda-novo` abrindo o formulário de novo agendamento).
- [ ] **Step 3:** `npm run manual` → "N capturas ok, 0 falharam"; `npm test` → verde.
- [ ] **Step 4: Verificar** `/ajuda` e `public/ajuda/manual.pdf`: imagens com dados do seed (agenda de 26/05/2026 cheia), nenhuma imagem em branco no PDF, capa com a data de hoje.
- [ ] **Step 5: Commit** `docs(ajuda): capítulos de acesso, clínica e agenda`
- [ ] **Step 6: Checkpoint com o usuário** — mostrar a página e o PDF; ajustar tom/visual antes de escrever o resto.

### Task 5: Parte I e Parte II restantes

**Files:** `checklist.md`, `profissionais.md`, `config-convenios.md`, `taxas.md`, `pagamentos.md`, `config-mensagens.md`, `ia.md`, `agente.md`, `anamnese.md`, `laboratorios.md`; `capturas.mjs`; imagens.

- [ ] **Step 1:** Ler cada `src/app/(dashboard)/configuracoes/<tela>/page.tsx` e componentes usados; listar campos e ações.
- [ ] **Step 2:** Escrever os capítulos. `checklist.md`: lista numerada na ordem dos capítulos 3–12 com link para cada um e uma linha dizendo o que fica pronto. Telas com chave (IA, Pagamentos, Mensagens, Agente): captura com `falsos` (`#ia-chave` → `sk-demo-0000000000000000`; demais → `demo-0000000000`), sem salvar.
- [ ] **Step 3:** `npm run manual` → 0 falhas; `npm test` → verde; conferir que nenhuma imagem mostra chave real.
- [ ] **Step 4: Commit** `docs(ajuda): checklist e capítulos de configuração`

### Task 6: Parte III — pacientes e orçamentos

**Files:** `pacientes.md`, `orcamentos.md`; `capturas.mjs`; imagens.

- [ ] **Step 1:** Ler `pacientes/page.tsx`, `pacientes/[id]/page.tsx`, `src/components/paciente/*`, `orcamentos/page.tsx`, `src/components/orcamentos/*`, `src/app/orcamento/[token]/page.tsx`.
- [ ] **Step 2:** Escrever: cadastro, cada aba da ficha (uma seção por aba, captura em `/pacientes/${PACIENTE_DEMO}` clicando na aba), funil, envio do link, assinatura. A página pública do orçamento: capturar com um token do seed se existir; se não existir, descrever sem imagem e anotar no relatório da task.
- [ ] **Step 3:** `npm run manual` → 0 falhas; `npm test` → verde.
- [ ] **Step 4: Commit** `docs(ajuda): capítulos de pacientes e orçamentos`

### Task 7: Parte III — mensagens, convênios, prótese, estoque

**Files:** `mensagens.md`, `convenios.md`, `protese.md`, `estoque.md`; `capturas.mjs`; imagens.

- [ ] **Step 1:** Ler as páginas e `src/components/{mensagens,convenios,protese,estoque,kits}/*`.
- [ ] **Step 2:** Escrever os capítulos; capturas por aba/tela principal e pelos formulários de criação abertos (sem salvar). Telas vazias no seed: capturar mesmo assim e explicar no texto o que aparece quando há dados.
- [ ] **Step 3:** `npm run manual` → 0 falhas; `npm test` → verde.
- [ ] **Step 4: Commit** `docs(ajuda): capítulos de mensagens, convênios, prótese e estoque`

### Task 8: Parte IV — financeiro e relatórios + PDF final

**Files:** `financeiro.md`, `relatorios.md`; `capturas.mjs`; imagens; `manual.pdf`; `gerado.json`.

- [ ] **Step 1:** Ler `financeiro/page.tsx`, `src/components/financeiro/*`, `src/components/pagamentos/*`, `relatorios/page.tsx`, `src/components/relatorios/*`.
- [ ] **Step 2:** Escrever: uma seção por aba do Financeiro (lançamentos, A receber, fluxo de caixa, livro-caixa/Carnê-Leão, comissões) e Relatórios/indicadores.
- [ ] **Step 3:** Conferir que nenhum capítulo ficou com "Em preparação." (`grep -l "Em preparação" src/content/ajuda/*.md` → vazio).
- [ ] **Step 4:** `npm run manual` → 0 falhas; `npm test`, `npm run lint`, `npm run build` → verdes.
- [ ] **Step 5: Verificar o PDF inteiro:** 21 capítulos, cada um em página nova, nenhuma imagem em branco ou cortada, rodapé numerado.
- [ ] **Step 6: Commit** `docs(ajuda): capítulos de financeiro e relatórios; PDF final`
