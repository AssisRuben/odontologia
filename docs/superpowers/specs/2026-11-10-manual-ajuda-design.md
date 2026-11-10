# Manual do sistema (Ajuda) — design

Data: 2026-11-10. Branch: `feat/manual-ajuda`. Fora do roteiro 0–9 (já concluído).

## Objetivo

Ter um manual de **todas** as funcionalidades, usado para **implantar o sistema numa clínica nova**: primeiro o roteiro de configuração inicial, depois o uso de cada tela no dia a dia.

Sucesso: a recepção de uma clínica nova abre **Ajuda** no menu, segue o checklist da Parte I, configura a clínica tela por tela (Parte II) com as capturas mostrando exatamente o que vê, e consegue baixar o mesmo conteúdo em PDF para imprimir ou mandar por WhatsApp. Quando uma tela muda, o desenvolvedor roda `npm run manual` e capturas + PDF são refeitos sozinhos.

## Decisões tomadas com o usuário

| Tema | Decisão |
|---|---|
| Público / uso | Implantação numa clínica nova (configuração inicial + uso diário) |
| Imagens | Capturas reais, tiradas automaticamente do app rodando com dados de exemplo |
| Entrega | Página "Ajuda" dentro do app **e** PDF para baixar |
| Acesso no app | Só um item "Ajuda" no menu, abrindo o manual completo com índice |
| Arquitetura | Textos em Markdown + página `/ajuda` + script Playwright que tira as capturas e gera o PDF a partir da própria página |
| Idioma | Só português |

## Fora do escopo

Botão "?" contextual em cada tela, checklist de implantação que detecta o que já foi configurado, busca própria (Ctrl+F resolve), outros idiomas, vídeos/GIFs, geração do PDF sob demanda no servidor.

## Conteúdo — capítulos

Ordem de implantação. Cada capítulo = um arquivo `src/content/ajuda/<slug>.md`.

**Parte I — Começando**

| # | slug | Título |
|---|---|---|
| 1 | `acesso` | Acesso: conta, login, menu, busca rápida, sino de pendências |
| 2 | `checklist` | Checklist de implantação (lista em texto, com links para cada capítulo, na ordem recomendada) |

**Parte II — Configuração inicial**

| # | slug | Título (tela) |
|---|---|---|
| 3 | `clinica` | Dados da clínica (`/configuracoes/clinica`) |
| 4 | `profissionais` | Profissionais, incluindo comissão (`/configuracoes/profissionais`) |
| 5 | `config-convenios` | Convênios/operadoras e tabela (`/configuracoes/convenios`) |
| 6 | `taxas` | Taxas de cartão (`/configuracoes/taxas`) |
| 7 | `pagamentos` | Pagamentos: cobrança Asaas e NFS-e (`/configuracoes/pagamentos`) |
| 8 | `config-mensagens` | Mensagens automáticas / WhatsApp (`/configuracoes/mensagens`) |
| 9 | `ia` | Inteligência artificial — chave OpenAI (`/configuracoes/ia`) |
| 10 | `agente` | Agente de IA no WhatsApp (`/configuracoes/agente`) |
| 11 | `anamnese` | Modelos de anamnese (`/configuracoes/anamnese`) |
| 12 | `laboratorios` | Laboratórios de prótese (`/configuracoes/laboratorios`) |

**Parte III — Dia a dia**

| # | slug | Título (tela) |
|---|---|---|
| 13 | `agenda` | Agenda (`/agenda`) |
| 14 | `pacientes` | Pacientes: cadastro e ficha — odontograma, anamnese, evoluções, orçamentos, documentos, prótese (`/pacientes`, `/pacientes/[id]`) |
| 15 | `orcamentos` | Orçamentos: funil, envio do link, assinatura pelo paciente (`/orcamentos`, `/orcamento/[token]`) |
| 16 | `mensagens` | Mensagens: caixa de conversas, passar para a recepção (`/mensagens`) |
| 17 | `convenios` | Convênios: guias, lote do mês, pagamento e glosas (`/convenios`) |
| 18 | `protese` | Prótese (`/protese`) |
| 19 | `estoque` | Estoque: entradas, saídas, contagem, kits, lista de compras (`/estoque`) |

**Parte IV — Gestão**

| # | slug | Título (tela) |
|---|---|---|
| 20 | `financeiro` | Financeiro: lançamentos, A receber, fluxo de caixa, livro-caixa/Carnê-Leão, comissões (`/financeiro`) |
| 21 | `relatorios` | Relatórios e painel de indicadores (`/relatorios`) |

### Modelo de cada capítulo

```markdown
## Para que serve
1–2 frases.

## Antes de começar
O que precisa estar configurado, com link: [Profissionais](#profissionais).
(omitido quando não há pré-requisito)

## <Tarefa> (uma seção por tarefa principal)
1. Passo numerado.
2. Passo numerado.

![Legenda curta](/ajuda/img/<slug>-<tarefa>.png)

## Dúvidas comuns
(só quando houver)
```

Regras de escrita:
- Cada passo é conferido no código da tela antes de ser escrito; nada é descrito sem existir.
- Nomes de botões e abas exatamente como aparecem na tela, em **negrito**.
- Linguagem para recepcionista/dentista, sem termos técnicos.
- O capítulo começa no `##` — o título (`#`) vem do índice, não do arquivo.
- Se, ao conferir o código, uma funcionalidade estiver em outra tela, o capítulo é ajustado e o índice também.

## Arquivos

| Arquivo | Papel |
|---|---|
| `src/content/ajuda/indice.ts` | Lista ordenada: `{ parte, slug, titulo }[]` — fonte única da ordem e dos títulos |
| `src/content/ajuda/<slug>.md` | Texto de cada capítulo (21 arquivos) |
| `src/app/(dashboard)/ajuda/page.tsx` | Página do manual (componente de servidor: lê os `.md` com `fs`) |
| `src/components/ajuda/*` | Índice lateral, capítulo renderizado, capa/sumário de impressão |
| `src/components/layout/Navbar.tsx` | Novo item "Ajuda" |
| `scripts/manual/capturas.mjs` | Lista de capturas |
| `scripts/manual/gerar.mjs` | Script do `npm run manual` |
| `public/ajuda/img/*.png` | Capturas (versionadas no git) |
| `public/ajuda/manual.pdf` | PDF (versionado no git) |
| `public/ajuda/gerado.json` | Data da última geração (versionado no git) |
| `tests/ajuda/manual.test.ts` | Consistência entre índice, textos e imagens |

Dependências novas: `react-markdown`, `remark-gfm` (dependências normais); `playwright` (só desenvolvimento).

## Página `/ajuda`

- Dentro do grupo `(dashboard)`: exige login e usa o layout atual (menu, cores).
- **Uma página única** com os 21 capítulos em sequência, agrupados pelas 4 partes. Cada capítulo é uma `<section id="<slug>">` com título vindo do `indice.ts`.
- Markdown renderizado com `react-markdown` + `remark-gfm`, mapeando cada elemento (`h2`, `p`, `ol`, `img`, `a`, `table`, `strong`) para classes do Tailwind com os tokens do app (petróleo/gengiva/tinta/porcelana) — sem plugin de tipografia.
- Imagens: `loading="lazy"`, largura máxima da coluna de texto, borda e sombra leves, legenda do `alt` abaixo.
- Links `#slug` navegam dentro da página.
- **Índice**: no computador (`md:` em diante), coluna fixa à esquerda do conteúdo, com as 4 partes e os capítulos, destacando o capítulo visível (IntersectionObserver — componente de cliente). No celular, botão "Índice" no topo que abre a lista e fecha ao escolher.
- Topo: título "Manual do sistema", data da última geração (lida de `public/ajuda/gerado.json`, `{ "data": "2026-11-10" }`, escrito pelo script com a data real do computador — não a `DATA_DEMO`; se o arquivo não existir, omitida) e botão **"Baixar PDF"** → `/ajuda/manual.pdf` (abre em nova aba). Se o PDF não existir, o botão não aparece.
- Arquivo `.md` ausente para um slug do índice: a página mostra "Capítulo em preparação." no lugar do texto (não quebra); o teste acusa antes disso chegar à main.

## Item no menu

- Em `navLinks` do `Navbar.tsx`, depois de Configurações: `{ label: 'Ajuda', href: '/ajuda', icon: HelpCircle }`.
- No celular, entra automaticamente na gaveta "Mais" (não está em `bottomNavLinks`).

## Script `npm run manual`

`package.json`: `"manual": "node --env-file=.env.local scripts/manual/gerar.mjs"`.

### Pré-requisitos (documentados no README)

1. App rodando (`npm run dev`) — endereço em `MANUAL_URL`, padrão `http://localhost:3000`.
2. Conta de demonstração criada em `/register` e preenchida com `scripts/seed.mjs` (`CLINIC_ID` dessa clínica). Sem chaves reais de OpenAI, Asaas ou WhatsApp.
3. `.env.local` com `MANUAL_EMAIL` e `MANUAL_SENHA` dessa conta.
4. `npx playwright install chromium` (uma vez).

Se `MANUAL_EMAIL`/`MANUAL_SENHA` faltarem ou o app não responder em `MANUAL_URL`, o script para na hora com mensagem clara do que falta.

### Capturas

`scripts/manual/capturas.mjs` exporta uma lista:

```js
{ arquivo: 'agenda-semana', url: '/agenda', passos: async (page) => { /* opcional */ }, falsos: { /* opcional */ } }
```

- `passos`: ações antes da foto (clicar numa aba, abrir um formulário, rolar até um bloco).
- `falsos`: seletor → valor de exemplo preenchido só para a captura (ex.: campo da chave OpenAI → `sk-demo-0000…`), para nenhuma chave real aparecer e os campos não saírem vazios. Nada é salvo: o script nunca clica em "Salvar" nessas telas.
- O ID do paciente usado nas capturas da ficha vem do seed (fixo: `PA(1)` do `seed.mjs`).
- **Relógio do navegador congelado** numa data dentro do período do seed (`page.clock.setFixedTime`, valor em `DATA_DEMO` no topo de `capturas.mjs`, inicialmente `2026-05-26T10:00:00-03:00`): os dados do `seed.mjs` têm datas fixas em maio/2026, e sem isso Agenda, Financeiro e Relatórios sairiam vazios. Ao atualizar o seed, ajusta-se só `DATA_DEMO`.
- Janela 1280×800, tema claro, fuso `America/Sao_Paulo`, idioma `pt-BR`. Antes da foto, espera a rede ficar ociosa e esconde o cursor/caret.
- Saída: `public/ajuda/img/<arquivo>.png` (só a área visível; `fullPage` apenas quando a entrada pedir).
- Login uma vez, reaproveitando a sessão em todas as capturas.

### Erros

- Cada captura roda isolada: se a tela não carrega ou um seletor não aparece em 15 s, registra o erro, **não grava** a imagem (mantém a anterior, se houver) e segue.
- No fim: resumo "N capturas ok, M falharam" com a lista das falhas; código de saída 1 se houve falha.
- O PDF só é gerado se todas as capturas deram certo.

### PDF

- Depois das capturas, abre `/ajuda` logado, espera todas as imagens carregarem (força o carregamento das `lazy`) e chama `page.pdf({ format: 'A4', printBackground: true, margin: 15 mm })`, numerando as páginas no rodapé.
- Antes de abrir a página, grava `public/ajuda/gerado.json` com a data de hoje (a capa e o topo usam essa data). A página do PDF **não** usa o relógio congelado.
- Grava em `public/ajuda/manual.pdf`.
- CSS de impressão (`print:` do Tailwind) na página `/ajuda`:
  - some o menu do app, o banner do WhatsApp, o índice lateral e o botão "Baixar PDF";
  - aparece uma **capa** (logo, "Manual do sistema", data de geração) e um **sumário** com as 4 partes e os capítulos;
  - cada capítulo começa em página nova (`break-before: page`); imagens não se partem entre páginas (`break-inside: avoid`).

## Testes

`tests/ajuda/manual.test.ts` (vitest, roda no `npm test`, sem navegador):

- todo slug do `indice.ts` tem `src/content/ajuda/<slug>.md`, e não há `.md` sobrando fora do índice;
- slugs únicos;
- toda imagem `/ajuda/img/*.png` citada nos `.md` existe em `public/ajuda/img/`;
- todo link `#slug` nos `.md` aponta para um slug do índice;
- nenhum `.md` começa com `# ` (título vem do índice).

O script de capturas em si não tem teste automático: a verificação é rodá-lo e olhar a página `/ajuda` e o PDF.

## Ordem de entrega sugerida

1. Estrutura: índice, página `/ajuda` com renderização, item no menu, teste de consistência — com capítulos ainda curtos.
2. Script de capturas + PDF, com 2–3 capítulos completos para validar o visual.
3. Os demais capítulos, conferidos no código tela por tela, com suas capturas.
