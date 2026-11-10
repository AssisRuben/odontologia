# Painel de indicadores (item 9): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar os números fictícios de Relatórios → Visão geral por indicadores reais do mês (agenda, faturamento/ticket, produção, orçamentos, pacientes novos), com variação contra o mês anterior, tendência de 6 meses e filtro por dentista.

**Architecture:** Definições em funções puras (`src/lib/indicadores/**`) sobre linhas lidas da janela de 6 meses; uma rota `GET /api/indicadores` monta a resposta; a página de Relatórios renderiza. Sem mudança no banco.

**Tech Stack:** Next.js 16, React 19, Supabase (leitura via service role), Vitest, `tests/fakeSupabase.ts`.

**Spec:** `docs/superpowers/specs/2026-11-08-indicadores-design.md`

## Global Constraints

- Next.js 16: ler `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` antes da rota; rodar `npx next typegen` depois de criá-la.
- Rota com `withClinic` (`src/lib/ia/rotas.ts`); toda leitura filtrada por `clinic_id`; listas com `lerTudo` (`src/lib/supabase/lerTudo.ts`).
- Fuso `America/Sao_Paulo` (`todayYmd(date, 'America/Sao_Paulo')` de `src/lib/messaging/time.ts`); mês `YYYY-MM`; dinheiro em centavos inteiros (`Math.round(reais * 100)`); `payments.paid_at` lido com `fromDbPaidAt`.
- Reusar `mesValido`, `mesDe`, `primeiroDia`, `ultimoDia`, `mesAnterior`, `rotuloMes` de `src/lib/comissoes/periodo.ts` e `buildFunnel`/`loadFunnelSources` do item 4 (`src/lib/orcamentos/funil.ts`, `repo.ts`) — sem copiar.
- Textos exatos: `'Mês inválido'` (422), `'Identificador inválido'` (422), `'Profissional não encontrado'` (404); avisos `'Mês em andamento: valores parciais'` e `'geral da clínica'`; rótulos de variação `▲ 5 p.p.`, `▼ 12%`, `novo`, `—`, `0 p.p.` / `0%` para empate.
- Sem biblioteca nova (gráficos com divs, como o mockup atual). Sem dados de paciente em logs. Português do Brasil; estilo atual das telas.

## Rulings sobre a spec

- **Fronteiras da janela no banco:** São Paulo não tem horário de verão desde 2019 → limites como `'{dia}T00:00:00-03:00'` (consultas, pacientes). `paid_at` usa a convenção do app (`T12:00:00Z`): filtrar `paid_at >= '{primeiro}T00:00:00Z'` e `< '{dia seguinte ao último}T00:00:00Z'`. A lib reclassifica tudo pelo mês em São Paulo de qualquer forma.
- **"Agora"** para "consulta já passada" = `Date` passado à função (a rota passa `new Date()`).
- **Pacientes que mais faltam** respeitam o filtro de dentista (fazem parte da agenda).
- **Cartão "Faltas"** mostra a contagem; variação em %.
- **Funil:** `loadFunnelSources` lê todos os orçamentos enviados (sem janela) — aceito, é o mesmo custo da tela de Orçamentos.

## Review Focus

1. **Consulta de hoje mais tarde** ainda não aconteceu → não entra em nenhuma taxa nem em "sem desfecho". → Task 1 (`consulta futura no mês corrente não conta`).
2. **Consulta às 22h de 31/10 em São Paulo** (01/11 em UTC) → conta em outubro. → Task 1 (`mês pela hora de São Paulo`).
3. **Paciente com dois recebimentos no mês** → conta uma vez no ticket médio. → Task 1 (`ticket conta paciente uma vez`).
4. **Janela atravessando o ano** (`2026-02`) → `2025-09 … 2026-02`. → Task 1 (`janela atravessa o ano`).
5. **Filtro por dentista** não muda recebido, ticket nem pacientes novos. → Task 2 (`filtro de dentista não afeta recebido`).

---

## File Structure

```
src/lib/indicadores/periodo.ts      (novo) janela de 6 meses
src/lib/indicadores/agenda.ts       (novo) contagens, taxas, por dentista, mais faltam
src/lib/indicadores/financeiro.ts   (novo) recebido, ticket, produção, pacientes novos
src/lib/indicadores/variacao.ts     (novo) variação e rótulo
src/lib/indicadores/painel.ts       (novo) monta a resposta
src/lib/indicadores/repo.ts         (novo) leitura da janela
src/app/api/indicadores/route.ts    (novo) GET
src/components/relatorios/*.tsx     (novos) cartões, blocos, mini-gráfico
src/app/(dashboard)/relatorios/page.tsx (mod) painel real, menu só "Visão geral"
README.md                           (mod)
```

### Task 1: Definições puras

**Files:**
- Create: `src/lib/indicadores/periodo.ts`, `agenda.ts`, `financeiro.ts`, `variacao.ts`
- Test: `tests/indicadores/periodo.test.ts`, `agenda.test.ts`, `financeiro.test.ts`, `variacao.test.ts`

**Interfaces:**
- Consumes: `src/lib/comissoes/periodo.ts`; `todayYmd`; `AppointmentStatus` de `src/types`.
- Produces:
  - `periodo.ts`: `mesesJanela(mes: string): string[]` (6 meses em ordem crescente terminando em `mes`); `mesDoInstante(iso: string): string` (mês em São Paulo de um timestamp).
  - `agenda.ts`:
    - `type ConsultaIn = { id: string; patient_id: string; professional_id: string; start_time: string; status: AppointmentStatus }`;
    - `type Contagem = { total: number; atendidas: number; faltas: number; canceladas: number; semDesfecho: number; comparecimento: number | null; taxaFaltas: number | null; taxaCancelamento: number | null }` (taxas em fração 0–1);
    - `resumoAgenda(consultas: ConsultaIn[], mes: string, agora: Date, professionalId: string | null): Contagem & { porDentista: ({ professional_id: string } & Contagem)[] }` — só `start_time < agora`, mês por `mesDoInstante`; definições da spec §Agenda; `porDentista` ordenado por `professional_id` (o painel põe nomes e reordena).
    - `maisFaltam(consultas: ConsultaIn[], meses: string[], agora: Date, professionalId: string | null): { patient_id: string; faltas: number; ultima: string }[]` — `no_show` passadas nos meses dados, 2+, ordem faltas desc, depois `ultima` desc; até 10 (nome vem do painel).
  - `financeiro.ts`:
    - `type RecebimentoIn = { patient_id: string; amount: number; payment_method: string | null; paid_at: string }` (já `status 'paid'`, `paid_at` `YYYY-MM-DD`);
    - `resumoFinanceiro(recs: RecebimentoIn[], mes: string): { recebidoCentavos: number; particularCentavos: number; convenioCentavos: number; pacientes: number; ticketCentavos: number | null; ticketParticularCentavos: number | null; ticketConvenioCentavos: number | null }` (ticket = `Math.round(soma / pacientes distintos)`; particular e convênio cada um sobre seus pacientes);
    - `type TratamentoIn = { professional_id: string | null; value: number; completed_at: string }`; `producao(trats: TratamentoIn[], mes: string, professionalId: string | null): { totalCentavos: number; porDentista: { professional_id: string | null; totalCentavos: number }[] }`;
    - `type PacienteIn = { id: string; name: string; created_at: string; source: string | null }`; `pacientesNovos(pacs: PacienteIn[], mes: string): { total: number; whatsapp: number }` (mês por `mesDoInstante(created_at)`, WhatsApp = `source === 'whatsapp'`).
  - `variacao.ts`: `type Variacao = { tipo: 'pp' | 'pct' | 'novo' | 'vazio'; valor: number | null }`; `variacaoTaxa(atual: number | null, anterior: number | null): Variacao` (pp = `(atual − anterior) × 100`, 1 casa; anterior nulo e atual não → `novo`; ambos nulos → `vazio`); `variacaoValor(atual: number, anterior: number): Variacao` (anterior 0 e atual > 0 → `novo`; ambos 0 → `vazio`; senão pct inteiro arredondado); `rotuloVariacao(v: Variacao): string` com os textos das Global Constraints.
- [ ] **Step 1: Testes** (valores exatos):
  - **`janela atravessa o ano`**: `mesesJanela('2026-02')` → `['2025-09','2025-10','2025-11','2025-12','2026-01','2026-02']`.
  - **`mês pela hora de São Paulo`**: consulta `2026-11-01T01:00:00Z` (22h de 31/10 SP) conta em `2026-10`.
  - **`consulta futura no mês corrente não conta`**: agora `2026-11-08T15:00:00Z`, consulta `scheduled` às `2026-11-08T20:00:00Z` → fora de tudo; `scheduled` às `2026-11-08T12:00:00Z` → `semDesfecho` 1.
  - Agenda: 9 atendidas (7 `completed` + 2 `in_progress`), 1 falta, 2 canceladas → `comparecimento` 0.9, `taxaFaltas` 0.1, `taxaCancelamento` 2/12 (total = 12 passadas, incluindo 0 sem desfecho); sem consultas → taxas `null`; filtro de dentista conta só o dele; `porDentista` com duas linhas.
  - `maisFaltam`: paciente com 3 faltas, outro com 2, outro com 1 → dois, o de 3 primeiro; empate de faltas desempata pela última falta mais recente; falta fora da janela não conta; limite 10.
  - **`ticket conta paciente uma vez`**: paciente A paga 100 + 50, B paga 150 → recebido 30000, pacientes 2, ticket 15000; convênio separado (A convênio 200 → `ticketConvenioCentavos` 20000); mês sem recebimentos → tickets `null`.
  - Produção: dois dentistas + um sem dentista; filtro por dentista; fora do mês ignorado.
  - Pacientes novos: 3 no mês, 1 `whatsapp`, 1 em outro mês.
  - Variação: `variacaoTaxa(0.9, 0.85)` → `{pp, 5}` e rótulo `'▲ 5 p.p.'`; `variacaoValor(88, 100)` → `'▼ 12%'`; `(5, 0)` → `'novo'`; `(0, 0)` → `'—'`; `(null, null)` → `'—'`; `(0.5, 0.5)` → `'0 p.p.'`.
- [ ] **Step 2–4:** rodar (FAIL), implementar, rodar (PASS).
- [ ] **Step 5: Commit** `feat(indicadores): definições dos indicadores`.

### Task 2: Montagem, leitura e rota

**Files:**
- Create: `src/lib/indicadores/painel.ts`, `src/lib/indicadores/repo.ts`, `src/app/api/indicadores/route.ts`
- Test: `tests/indicadores/painel.test.ts`, `tests/indicadores/rota.test.ts`

**Interfaces:**
- Consumes: Task 1; `buildFunnel`, `FunnelRow`, `Funnel`, `loadFunnelSources`.
- Produces:
  - `painel.ts`: `type EntradaPainel = { consultas: ConsultaIn[]; recebimentos: RecebimentoIn[]; tratamentos: TratamentoIn[]; pacientes: PacienteIn[]; funil: FunnelRow[]; profissionais: { id: string; name: string }[]; nomesPacientes: Record<string, string> }`; `type Cartao = { valor: number | null; variacao: Variacao }`; `montarPainel(e: EntradaPainel, mes: string, agora: Date, professionalId: string | null): Painel` com `Painel = { mes; hoje; parcial: boolean; dentista: { id; name } | null; cartoes: { comparecimento: Cartao; faltas: Cartao; recebido: Cartao; ticket: Cartao; aprovacao: Cartao; novos: Cartao }; agenda: Contagem & { porDentista: ({ professional_id; nome } & Contagem)[]; maisFaltam: { patient_id; nome; faltas; ultima }[] }; financeiro: ReturnType<typeof resumoFinanceiro> & { producao: { totalCentavos; porDentista: { professional_id; nome; totalCentavos }[] } }; orcamentos: Funnel; novos: { total; whatsapp }; tendencia: { mes; comparecimento: number | null; recebidoCentavos: number; ticketCentavos: number | null; aprovacao: number | null; novos: number }[] }`. `parcial` = `mes === mesDe(hoje)`; `aprovacao` = `buildFunnel(...).rateCents`; variação contra `mesAnterior(mes)`; nomes `'Sem dentista'` para `null`; `porDentista` ordenados por nome (`localeCompare` pt-BR).
  - `repo.ts`: `entradaPainel(admin: SupabaseClient, clinicId: string, meses: string[]): Promise<EntradaPainel>` — leituras da janela conforme os Rulings (consultas `id, patient_id, professional_id, start_time, status`; recebimentos `status 'paid'`; tratamentos `status 'completed'` com `completed_at` na janela; pacientes `created_at` na janela; funil via `loadFunnelSources`; profissionais; nomes dos pacientes que aparecem em faltas, em pedaços de 100 ids).
  - Rota: `GET /api/indicadores?mes=&dentista=` → 200 `Painel`; `mes` inválido → 422; `dentista` não UUID → 422; dentista fora da clínica → 404.
- [ ] **Step 1: Testes:** `montarPainel` com cenário de dois meses → cartões com valores e variações certos; **`filtro de dentista não afeta recebido`** (recebido/ticket/novos iguais com e sem filtro; agenda/produção/orçamentos mudam); `tendencia` com 6 itens em ordem; `parcial` true no mês corrente; nomes e "Sem dentista"; rota: 422 `'Mês inválido'` (ausente e `'2026-13'`), 422 dentista inválido, 404 dentista de outra clínica, 200 com todas as leituras filtradas por `clinic_id`, paginação (1000 + 1 consultas).
- [ ] **Step 2–4:** rodar (FAIL), implementar, `npx next typegen`, rodar (PASS) + `npx tsc --noEmit -p .` + `npx vitest run`.
- [ ] **Step 5: Commit** `feat(indicadores): montagem do painel, leitura e rota`.

### Task 3: Tela e README

**Files:**
- Create: `src/components/relatorios/CartaoIndicador.tsx`, `MiniGrafico.tsx`, `BlocoAgenda.tsx`, `BlocoFinanceiro.tsx`, `BlocoOrcamentos.tsx`
- Modify: `src/app/(dashboard)/relatorios/page.tsx`, `README.md`

**Interfaces:**
- Consumes: Task 2 (`Painel` e a rota), `rotuloVariacao`, `rotuloMes`, `mesDe`, `mesAnterior`.
- Produces: tela da spec §Tela:
  - seletor de mês (padrão `mesDe(hoje)`, setas, aviso `'Mês em andamento: valores parciais'` quando `parcial`) e `<select>` de dentista ("Todos os dentistas" + profissionais da clínica, lidos como as outras telas fazem); recarrega com proteção contra resposta antiga (sequência, como em `AbaComissoes.tsx`);
  - 6 cartões (taxas em `%` inteiro, dinheiro `toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })`, `null` → `—`), variação verde/vermelha (para Faltas, ▲ é ruim → vermelho); cartões de recebido, ticket e novos com `'geral da clínica'` quando há filtro;
  - Agenda: contagens, alerta `N consultas sem desfecho` com link `/agenda`, tabela por dentista, "Pacientes que mais faltam" com link `/pacientes/{id}`;
  - Financeiro: particular × convênio, tickets, produção por dentista;
  - Orçamentos: apresentados, aprovados, taxas, tempo médio, por dentista, link `/orcamentos`;
  - Tendência: 5 `MiniGrafico` (barras com divs, rótulo do mês `mm/aa`);
  - menu lateral só com "Visão geral" (remover os itens "Em desenvolvimento" e todo o conteúdo fictício);
  - README: seção "## Indicadores" com cada definição da spec e o que não faz.
- [ ] **Step 1:** implementar; `npx tsc --noEmit -p .`, `npx eslint` nos arquivos tocados, `npx vitest run`.
- [ ] **Step 2: Commit** `feat(indicadores): painel em Relatórios e README`.
