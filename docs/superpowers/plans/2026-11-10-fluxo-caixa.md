# Fluxo de caixa e despesas recorrentes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o placeholder da aba "Financeiro > Fluxo de caixa" por um fluxo de 8 meses (2 realizados + 6 previstos) com saldo acumulado a partir de um saldo informado, e permitir despesas recorrentes que geram despesas "a pagar" reais.

**Architecture:**
- **Banco:** uma migração SQL cria `cash_balances`, `expense_recurrences`, as colunas de vínculo em `expenses` e as funções de geração, edição e encerramento das recorrências.
- **Cálculo:** é uma função pura em `src/lib/fluxo/calcular.ts`. A rota GET `/api/financeiro/fluxo` gera as recorrências pendentes, busca pagamentos e despesas e devolve o fluxo calculado.
- **Telas:** o componente `FluxoCaixa` (com um gráfico SVG próprio) entra na aba. A tela de Despesas ganha os controles de recorrência.

**Tech Stack:** Next.js 16.2.6 (App Router, Turbopack), Supabase/PostgREST, PL/pgSQL, React, Tailwind v4 (tokens tinta, linha, porcelana, petroleo, gengiva), date-fns, vitest. Sem biblioteca de gráficos (não instalar nenhuma).

**Spec:** `docs/superpowers/specs/2026-11-10-fluxo-caixa-design.md`

## Global Constraints

- **Next.js:** antes de escrever código Next, leia o guia relevante em `node_modules/next/dist/docs/` (AGENTS.md). Rotas usam `export const dynamic = 'force-dynamic'`, e `params` é `Promise<{ id: string }>`.
- **Funções SQL:** `SECURITY DEFINER SET search_path = public`; `RAISE EXCEPTION 'CODIGO'`; `FOR UPDATE` filtrado por `clinic_id`; `REVOKE ALL … FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE … TO service_role`.
- **Migração:** `supabase/2026-11-10-fluxo-caixa.sql`, que pode ser rodada mais de uma vez, com cabeçalho no estilo de `supabase/2026-11-10-kits.sql`. O conteúdo é acrescentado ao fim de `supabase/schema.sql`.
- **Erros nas rotas:** `withClinic` vem de `@/lib/ia/rotas`; `respostaDeErro` e o tipo `Mapa` vêm de `@/lib/convenios/rotas`.
- **Dinheiro:**
  - centavos (inteiros) na API e no cálculo; reais (`NUMERIC`) no banco;
  - entrada de valores com `parseReaisInput`;
  - exibição com `formatValor` ou `formatCurrency`, como nas telas atuais do Financeiro.
- **Data de hoje:**
  - no servidor: `todayYmd(new Date(), 'America/Sao_Paulo')` de `@/lib/messaging/time`;
  - no SQL: `(now() AT TIME ZONE 'America/Sao_Paulo')::date`;
  - um `paid_at` (timestamptz) vira data de São Paulo antes de entrar no cálculo.
- **Janela do fluxo:** do dia 1 de `mês(hoje) − 2` até o último dia de `mês(hoje) + 5` (8 meses).
- **Geração:** sempre até `mês atual + 5` (6 meses contando o atual).
- **Vencimento do mês M:** `make_date(ano(M), mês(M), least(day_of_month, último dia de M))`.
- **React:** a regra eslint react-hooks não permite `setState` síncrono no corpo de um effect. Busque os dados dentro do effect com uma variável de cancelamento.
- **Testes no Windows:** rode do PowerShell, com `Set-Location C:\Workspace\odontologia`, usando `npx vitest run <arquivo>`.
- **Textos:** os textos de interface ficam exatamente como na seção "Telas" da spec, em português.
- **Commits:** terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Pagamento recebido logo após meia-noite em São Paulo:** um `paid_at` como `2026-11-01T02:30:00Z` cai no dia 31/10 em São Paulo e entra no fluxo de outubro (Task 2).
2. **Saldo informado no meio da janela, com movimentos realizados antes e depois dele:** o saldo do fim do dia S é exatamente o valor informado, os dias anteriores desfazem os movimentos e os posteriores somam (Task 2).
3. **Recorrência criada no dia 31 com término:** em fevereiro vence no dia 28 ou 29, e nada é gerado depois do mês de término (Task 1, verificação ao vivo na Task 6).
4. **Despesa gerada que o usuário apagou:** não volta na próxima abertura das abas (Task 1, verificação ao vivo na Task 6).
5. **Sem saldo informado e sem nenhum lançamento:** a aba mostra tudo zerado, com o convite para informar o saldo, sem erro (Tasks 2 e 4).

---

### Task 1: Migração SQL e tipos

**Files:**
- Create: `supabase/2026-11-10-fluxo-caixa.sql`
- Modify: `supabase/schema.sql` (acrescentar no fim)
- Modify: `src/types/index.ts`

**Interfaces:**
- **Produces, banco:** conforme a seção "Dados" da spec.
  - Tabelas `cash_balances` e `expense_recurrences`.
  - Colunas `expenses.recurrence_id` e `expenses.recurrence_month`, com índice único `expenses_recurrence_month_uidx (recurrence_id, recurrence_month)`.
  - Funções:
    - `generate_recurring_expenses(p_clinic_id uuid) returns integer`
    - `create_expense_recurrence(p_clinic_id uuid, p_data jsonb) returns uuid`
    - `update_expense_recurrence(p_clinic_id uuid, p_id uuid, p_data jsonb, p_from_month date) returns integer`
    - `end_expense_recurrence(p_clinic_id uuid, p_id uuid, p_last_month date) returns integer`
  - `p_data` vem como `{description, amount (reais), category, deduction_group, payment_method, day_of_month, start_month 'YYYY-MM-01', end_month 'YYYY-MM-01'|null}`.
    - Em `update`, `start_month` e `end_month` são ignorados.
    - `create` chama `generate_recurring_expenses` no fim.
- **Produces, `src/types/index.ts`:**
  - `export interface CashBalance { id: string; clinic_id: string; balance_date: string; amount: number; created_by: string | null; created_at: string }`
  - `export interface ExpenseRecurrence { id: string; clinic_id: string; description: string; amount: number; category: ExpenseCategory; deduction_group: DeductionGroup | null; payment_method: PaymentMethod | null; day_of_month: number; start_month: string; end_month: string | null; generated_until: string | null; created_at: string; updated_at: string }`
  - em `Expense`: `recurrence_id?: string | null` e `recurrence_month?: string | null`

- [ ] **Step 1: Escrever as tabelas, as colunas, os índices e a RLS `clinic_member`** (modelo: `inventory_kits` em `supabase/2026-11-10-kits.sql`).
  - Os CHECKs de `category`, `deduction_group` e `payment_method` em `expense_recurrences` copiam os valores atuais de `expenses`. Os de `category` incluem `'comissoes'`, conforme `schema.sql` na linha ~2341.
  - CHECK de `start_month`: `extract(day from start_month) = 1`. O mesmo vale para `end_month` quando não for nulo.

- [ ] **Step 2: Escrever `generate_recurring_expenses`**, conforme a spec:
  - percorre as recorrências da clínica com `FOR UPDATE ORDER BY id`;
  - insere com `ON CONFLICT (recurrence_id, recurrence_month) DO NOTHING`;
  - atualiza `generated_until`;
  - devolve o total inserido.
  - O loop de meses usa `generate_series(inicio, fim, interval '1 month')::date`.

- [ ] **Step 3: Escrever `create_expense_recurrence`, `update_expense_recurrence` e `end_expense_recurrence`.**
  - **Erros:**
    - `VALOR_INVALIDO` (amount ≤ 0 ou ausente);
    - `DIA_INVALIDO` (fora de 1 a 31);
    - `PERIODO_INVALIDO` (`end_month < start_month`, ou `p_last_month < start_month`);
    - `DADOS_INVALIDOS` (descrição vazia, categoria ou forma inválida);
    - `RECORRENCIA_NAO_ENCONTRADA`.
  - **Update:** atualiza a recorrência e `updated_at`. Depois atualiza as despesas da recorrência com `recurrence_month >= p_from_month AND status <> 'paid'`: description, amount, category, deduction_group, payment_method e `due_date` recalculado pela regra do vencimento.
  - **End:** grava `end_month = p_last_month` e apaga as despesas com `recurrence_month > p_last_month AND status <> 'paid'`.
  - Todas filtram por `clinic_id`.

- [ ] **Step 4: Fechar a migração.**
  - Permissões (REVOKE e GRANT) das 4 funções.
  - Bloco final **comentado** com o `cron.schedule('expenses-recurring', '0 9 * * *', $$SELECT public.generate_recurring_expenses(id) FROM clinics$$)`.
  - Copiar o arquivo inteiro para o fim de `schema.sql`.

- [ ] **Step 5: Atualizar os tipos.** Rode `npx tsc --noEmit` e `npx vitest run`. Esperado: sem erros e tudo passando. O SQL não é rodado nesta task; o controlador verifica ao vivo na Task 6.

- [ ] **Step 6: Commit:** `feat(fluxo): migração de saldo informado e despesas recorrentes`

---

### Task 2: Cálculo do fluxo (função pura)

**Files:**
- Create: `src/lib/fluxo/calcular.ts`
- Test: `tests/fluxo/calcular.test.ts`

**Interfaces:**
- **Produces:**
  - `export type PagamentoFluxo = { id: string; valorCentavos: number; liquidoCentavos: number | null; status: 'pending'|'paid'|'overdue'|'cancelled'|'refunded'; vencimento: string | null; pagoEm: string | null; descricao: string }`. `pagoEm` é um timestamp ISO; `descricao` é o nome do paciente ou a descrição.
  - `export type DespesaFluxo = { id: string; valorCentavos: number; status: 'pending'|'paid'|'overdue'; vencimento: string | null; pagoEm: string | null; descricao: string; recorrente: boolean }`
  - `export type Movimento = { tipo: 'entrada'|'saida'; descricao: string; valorCentavos: number; previsto: boolean }`
  - `export type DiaFluxo = { data: string; movimentos: Movimento[]; saldoFinalCentavos: number }`
  - `export type MesFluxo = { mes: string /* 'YYYY-MM' */; saldoInicialCentavos: number; entradasCentavos: number; saidasCentavos: number; saldoFinalCentavos: number; situacao: 'realizado'|'atual'|'previsto'; dias: DiaFluxo[] }`
  - `export type Fluxo = { meses: MesFluxo[]; saldoHojeCentavos: number; saldoFinalPrevistoCentavos: number; menorSaldo: { valorCentavos: number; data: string }; emAtraso: { totalCentavos: number; quantidade: number }; semSaldoInformado: boolean }`
  - `export function dataSaoPaulo(iso: string): string`: transforma um timestamp ISO em 'YYYY-MM-DD' de São Paulo, usando `Intl.DateTimeFormat` com `timeZone: 'America/Sao_Paulo'`.
  - `export function montarFluxo(e: { hoje: string; saldo: { data: string; valorCentavos: number } | null; pagamentos: PagamentoFluxo[]; despesas: DespesaFluxo[] }): Fluxo`

- [ ] **Step 1: Escrever os testes que falham** em `tests/fluxo/calcular.test.ts`, com `hoje = '2026-11-10'`:
  - **Janela:** `meses.map(m => m.mes)` é igual a `['2026-09','2026-10','2026-11','2026-12','2027-01','2027-02','2027-03','2027-04']`. As situações são `realizado, realizado, atual, previsto…`.
  - **Sem saldo e sem lançamentos:** todos os valores são 0, `semSaldoInformado === true`, `menorSaldo` é `{0, '2026-11-10'}` e `emAtraso` é `{0, 0}`.
  - **Saldo informado em 2026-10-15, valor 100000:**
    - um pagamento pago em `2026-10-10T15:00:00Z` (50000) e uma despesa paga em `2026-10-20T15:00:00Z` (20000);
    - o saldo do fim de 2026-10-15 é 100000;
    - o saldo inicial de outubro é 50000 (desfaz o recebimento do dia 10);
    - o saldo final de outubro é 80000;
    - o `saldoHojeCentavos` é 80000.
  - **Valor líquido:** um pagamento pago com `valorCentavos` 10000 e `liquidoCentavos` 9500 soma 9500 nas entradas.
  - **Atrasado:** um pagamento `overdue` com vencimento em 2026-11-05 (30000) não entra em nenhuma entrada nem no saldo, e `emAtraso` é `{30000, 1}`.
  - **Previsto:** um pagamento `pending` com vencimento em 2026-12-05 (40000) entra nas entradas de dezembro, com `previsto: true` no dia 2026-12-05.
  - **Despesa vencida:** uma despesa `pending` com vencimento em 2026-11-03 (15000) entra como saída de 2026-11-10 (hoje), com `previsto: true`.
  - **Despesa sem vencimento:** também entra como saída de hoje.
  - **Cancelados:** pagamentos `cancelled` e `refunded` são ignorados.
  - **Menor saldo:** com saldo de 10000 hoje e uma despesa prevista de 30000 em 2027-01-10, `menorSaldo` é `{-20000, '2027-01-10'}` e o `saldoFinalPrevistoCentavos` é -20000.
  - **Fuso:** `dataSaoPaulo('2026-11-01T02:30:00Z')` é `'2026-10-31'`. Um pagamento pago nesse instante entra em outubro.
  - **Saldo antes da janela:** com saldo informado em 2026-07-01 (0) e um recebimento em 2026-08-15 (5000), o saldo inicial de setembro é 5000.
  - **Dias:** `dias` traz só os dias com movimento, em ordem crescente.

- [ ] **Step 2: Rodar `npx vitest run tests/fluxo/calcular.test.ts`.** Esperado: FAIL, módulo inexistente.

- [ ] **Step 3: Implementar `calcular.ts`.**
  - **Abordagem:** monte um mapa `data → delta` com os movimentos realizados e previstos, conforme a seção "Cálculo" da spec.
  - O saldo de referência é `saldo.valorCentavos` no fim do dia `saldo.data`, ou 0 no fim do dia anterior ao início da janela quando não houver saldo informado.
  - O saldo do fim de um dia D é `ref + soma(deltas em (S, D])` quando D ≥ S, ou `ref − soma(deltas em (D, S])` quando D < S.
  - Os movimentos usados nessa soma podem estar fora da janela. Com saldo informado antes da janela, os realizados entre S e o início da janela também contam.
  - Use `date-fns` para manipular datas (somente datas 'YYYY-MM-DD').
  - **Pagamento não pago sem vencimento:** fica de fora do saldo e de `emAtraso`. É uma visão conservadora; não há data para prevê-lo. Inclua um teste para isso.

- [ ] **Step 4: Rodar `npx vitest run tests/fluxo/calcular.test.ts`.** Esperado: PASS.

- [ ] **Step 5: Commit:** `feat(fluxo): cálculo do fluxo de caixa`

---

### Task 3: Validação, repo e rotas da API

**Files:**
- Create: `src/lib/fluxo/validar.ts`, `src/lib/fluxo/rotas.ts`, `src/lib/fluxo/repo.ts`
- Create: `src/app/api/financeiro/fluxo/route.ts` (GET)
- Create: `src/app/api/financeiro/saldo/route.ts` (POST)
- Create: `src/app/api/financeiro/recorrencias/route.ts` (POST)
- Create: `src/app/api/financeiro/recorrencias/[id]/route.ts` (PATCH)
- Create: `src/app/api/financeiro/recorrencias/[id]/encerrar/route.ts` (POST)
- Create: `src/app/api/financeiro/recorrencias/gerar/route.ts` (POST)
- Test: `tests/fluxo/validar.test.ts`, `tests/fluxo/repo.test.ts`, `tests/fluxo/rotas-api.test.ts`

**Interfaces:**
- **Consumes:** `montarFluxo`, `PagamentoFluxo`, `DespesaFluxo` e `dataSaoPaulo` da Task 2, e as funções SQL da Task 1.
- **Produces, `validar.ts`:**
  - `parseSaldo(raw, hoje: string): { ok: true; input: { data: string; valorCentavos: number } } | { ok: false; error: string }`
    - `valorCentavos` é inteiro (pode ser negativo, com |v| ≤ 99999999999);
    - `data` é uma data válida, não futura.
    - Erros: `'Data inválida'`, `'A data não pode ser futura'`, `'Valor inválido'`.
  - `parseRecorrencia(raw, modo: 'criar'|'editar')`, com os campos `{ description, amountCentavos, category, deductionGroup, paymentMethod, dayOfMonth, startMonth: 'YYYY-MM', endMonth: 'YYYY-MM'|null, aPartirDe?: 'YYYY-MM' }`.
    - No modo editar, `aPartirDe` é obrigatório; `startMonth` e `endMonth` são ignorados.
    - Erros: `'Informe a descrição'`, `'Valor inválido'`, `'Dia inválido'`, `'Período inválido'`, `'Dados inválidos'`.
  - `parseEncerrar(raw): { ok: true; ultimoMes: 'YYYY-MM' } | { ok: false; error: string }`
- **Produces, `rotas.ts`:** `ERROS_FLUXO: Mapa`, com as entradas:

  | Código | Status | Mensagem |
  |---|---|---|
  | `VALOR_INVALIDO` | 422 | 'Valor inválido' |
  | `DIA_INVALIDO` | 422 | 'Dia inválido' |
  | `PERIODO_INVALIDO` | 422 | 'Período inválido' |
  | `DADOS_INVALIDOS` | 422 | 'Dados inválidos' |
  | `RECORRENCIA_NAO_ENCONTRADA` | 404 | 'Recorrência não encontrada' |

- **Produces, `createFluxoRepo(admin)`:**
  - `gerar(clinicId): Promise<number>`
  - `saldoAtual(clinicId): Promise<{ data: string; valorCentavos: number } | null>`
  - `informarSaldo(clinicId, userId, i): Promise<void>`
  - `dados(clinicId, janela: { inicio: string; fim: string }, desde: string): Promise<{ pagamentos: PagamentoFluxo[]; despesas: DespesaFluxo[] }>`
    - Pagamentos: `status='paid'` com `paid_at >= desde` (início do dia em São Paulo), mais os não pagos (`pending` e `overdue`) com `due_date <= janela.fim`. A descrição é `patient.name ?? description`.
    - Despesas: o mesmo critério dos pagamentos. `recorrente = recurrence_id != null`.
    - Tudo filtrado por `clinic_id`, com conversão de reais para centavos via `Math.round(x * 100)`.
  - `criarRecorrencia(clinicId, i): Promise<string>`
  - `editarRecorrencia(clinicId, id, i): Promise<number>`
  - `encerrarRecorrencia(clinicId, id, ultimoMes): Promise<number>`
- **Produces, rotas:**
  - **GET `/api/financeiro/fluxo`:**
    1. `gerar`;
    2. `saldoAtual`;
    3. `dados(janela, desde = min(janela.inicio, saldo?.data ?? janela.inicio))`;
    4. responde 200 com `{ ...montarFluxo(...), saldoInformado }`.
  - **POST `saldo`:** responde 201 `{ ok: true }`.
  - **POST `recorrencias`:** responde 201 `{ id }`.
  - **PATCH `recorrencias/[id]`:** responde 200 `{ alteradas }`.
  - **POST `encerrar`:** responde 200 `{ apagadas }`.
  - **POST `gerar`:** responde 200 `{ criadas }`.
  - Um `id` que não é uuid dá 404 `{ error: 'Recorrência não encontrada' }`.
  - Erros do banco passam por `respostaDeErro(e, ERROS_FLUXO)`.

- [ ] **Step 1: Escrever os testes que falham.**
  - **`validar.test.ts`:**
    - data futura dá `'A data não pode ser futura'`;
    - saldo negativo -50000 é aceito;
    - valor 12.5 dá `'Valor inválido'`;
    - dia 0 e dia 32 dão `'Dia inválido'`;
    - `endMonth` anterior a `startMonth` dá `'Período inválido'`;
    - editar sem `aPartirDe` dá `'Dados inválidos'`.
  - **`repo.test.ts`,** com `fakeAdmin` de `tests/fakeSupabase.ts`, no estilo de `tests/kits/repo.test.ts`:
    - `dados` filtra por `clinic_id` em todas as consultas e converte 123.45 em 12345;
    - `criarRecorrencia` chama a rpc `create_expense_recurrence` com `start_month: '2026-11-01'` e `amount: 150` para `amountCentavos: 15000`;
    - `saldoAtual` ordena por `balance_date` desc e depois `created_at` desc, com limite 1.
  - **`rotas-api.test.ts`,** com o padrão de `tests/kits/rotas-api.test.ts` (mock de `withClinic` e do repo):
    - GET fluxo responde 200 com `meses.length === 8`;
    - POST saldo com data futura responde 422;
    - PATCH com id inválido responde 404;
    - um erro `{message:'PERIODO_INVALIDO'}` no encerrar responde 422 `'Período inválido'`.

- [ ] **Step 2: Rodar `npx vitest run tests/fluxo`.** Esperado: FAIL.

- [ ] **Step 3: Implementar os arquivos.**

- [ ] **Step 4: Verificar.** Rode `npx vitest run tests/fluxo`, `npx tsc --noEmit` e `npx eslint src/lib/fluxo src/app/api/financeiro tests/fluxo`. Esperado: PASS e sem erros.

- [ ] **Step 5: Commit:** `feat(fluxo): rotas do fluxo de caixa, saldo e recorrências`

---

### Task 4: Aba Fluxo de caixa

**Files:**
- Create: `src/components/financeiro/FluxoCaixa.tsx`
- Create: `src/components/financeiro/GraficoFluxo.tsx`
- Create: `src/components/financeiro/ModalSaldo.tsx`
- Modify: `src/app/(dashboard)/financeiro/page.tsx` (`activeTab === 'fluxo'` renderiza `<FluxoCaixa onVerPainel={() => setActiveTab('painel')} />`; o placeholder continua só para 'boletos')

**Interfaces:**
- **Consumes:** GET `/api/financeiro/fluxo` (o tipo `Fluxo` da Task 2 + `saldoInformado`) e POST `/api/financeiro/saldo` `{ data, valorCentavos }`.
- **Produces:**
  - `FluxoCaixa({ onVerPainel }: { onVerPainel: () => void })`
  - `GraficoFluxo({ meses }: { meses: MesFluxo[] })`
  - `ModalSaldo({ onClose, onSaved }: { onClose: () => void; onSaved: () => void })`

- [ ] **Step 1: Implementar `GraficoFluxo`**, em SVG com `viewBox` e largura 100%.
  - Para cada mês, duas barras: entradas (gengiva) e saídas (vermelho, igual ao vermelho do Painel `#EF4444`).
  - Uma linha (petroleo) liga os saldos finais, com um ponto em cada mês.
  - Os meses `previsto` ficam com opacidade 0.5 e o trecho da linha dos previstos é tracejado.
  - A escala vertical inclui o 0, com uma linha de base visível quando existirem saldos negativos.
  - Rótulo do mês embaixo (`MMM/yy` em pt-BR).
  - Cada barra tem um `<title>` com o valor formatado, para o tooltip nativo.
  - `role="img"` e `aria-label="Gráfico do fluxo de caixa"`.

- [ ] **Step 2: Implementar `ModalSaldo`.**
  - Usa o mesmo estilo dos modais do Financeiro (veja `ModalDespesa`).
  - Campos: data (padrão hoje, `max` = hoje) e valor (aceita sinal de menos, lido com `parseReaisInput`).
  - Envia POST e mostra `json.error` se der erro.

- [ ] **Step 3: Implementar `FluxoCaixa`**, com os textos e a ordem da seção "Telas" da spec:
  - os 3 cartões;
  - a linha do saldo informado, com o botão "Informar saldo", ou o convite quando não houver saldo;
  - o gráfico;
  - a tabela mensal, com a marca "previsto";
  - o saldo final negativo em vermelho;
  - a linha clicável que abre e fecha o dia a dia;
  - a linha "Em atraso", com "Ver no Painel";
  - o dia a dia.
  - Estados de carregando e de erro, com o botão "Tentar de novo".

- [ ] **Step 4: Verificar.**
  - Rode `npx tsc --noEmit` e `npx eslint src/components/financeiro "src/app/(dashboard)/financeiro"`. O erro de lint `setState` em effect que já existe em `page.tsx`, se houver, não conta; não introduza nenhum novo.
  - Rode `npx vitest run`. Esperado: tudo passa.

- [ ] **Step 5: Commit:** `feat(fluxo): aba Fluxo de caixa`

---

### Task 5: Despesas recorrentes na tela de Despesas

**Files:**
- Modify: `src/components/financeiro/ModalDespesa.tsx`
- Modify: `src/components/financeiro/ListaDespesas.tsx`
- Create: `src/lib/fluxo/recorrencia.ts`
- Test: `tests/fluxo/recorrencia.test.ts`

**Interfaces:**
- **Consumes:** POST `/api/financeiro/recorrencias`, PATCH `/api/financeiro/recorrencias/[id]` (`{...campos, aPartirDe}`), POST `…/[id]/encerrar` `{ ultimoMes }`, POST `/api/financeiro/recorrencias/gerar`, e `Expense.recurrence_id/recurrence_month` da Task 1.
- **Produces, `recorrencia.ts`:**
  - `mesDe(ymd: string): string`, que devolve 'YYYY-MM';
  - `diaDe(ymd: string): number`;
  - `rotuloMes(mes: 'YYYY-MM'): string`, que devolve "novembro/2026".

- [ ] **Step 1: Escrever os testes que falham** em `tests/fluxo/recorrencia.test.ts`:
  - `mesDe('2026-11-30')` dá `'2026-11'`;
  - `diaDe('2026-11-30')` dá `30`;
  - `rotuloMes('2026-02')` dá `'fevereiro/2026'`.

  Rode, implemente, rode de novo. Esperado: PASS.

- [ ] **Step 2: Mudar o `ModalDespesa`.**
  - **Despesa nova:** a caixa "Repete todo mês" mostra os campos "Dia do vencimento" (padrão `diaDe(vencimento)`) e "Até (opcional)" (`<input type="month">`).
  - **Salvar com a caixa marcada:** envia POST recorrências, com `startMonth = mesDe(vencimento)`, em vez de gravar a despesa direto.
  - **Editar despesa com `recurrence_id`:** antes de salvar, pergunta "Alterar só esta" ou "Esta e as próximas".
    - "Só esta" faz o update atual.
    - "Esta e as próximas" envia PATCH com `aPartirDe = recurrence_month` (em 'YYYY-MM'), usando os campos editados.
  - Mostra `json.error` em caso de erro.

- [ ] **Step 3: Mudar o `ListaDespesas`.**
  - Ícone `Repeat` (lucide) com `title="Despesa recorrente"` nas despesas com `recurrence_id`.
  - Nas recorrentes, a ação "Encerrar recorrência", com o confirm "Encerrar após <rotuloMes(recurrence_month)>? As próximas ainda não pagas serão apagadas." Ela envia POST encerrar com `ultimoMes = mesDe(recurrence_month)` e recarrega a lista.
  - Ao montar, envia POST gerar. Se `criadas > 0`, recarrega a lista. Segue a regra de effect com cancelamento.

- [ ] **Step 4: Verificar.** Rode `npx tsc --noEmit`, `npx eslint src/components/financeiro src/lib/fluxo` e `npx vitest run`. Esperado: sem erros novos e tudo passando.

- [ ] **Step 5: Commit:** `feat(fluxo): despesas recorrentes`

---

### Task 6: Verificação ao vivo (feita pelo controlador)

Feita pelo controlador, porque usa as credenciais do usuário. Só depois que o usuário rodar `supabase/2026-11-10-fluxo-caixa.sql`.

- [ ] **Step 1: SQL via REST com service role**, num script no scratchpad. Os dados de teste têm "Teste Claude" na descrição e são apagados no fim.
  - **Criar recorrência:** dia 31, início no mês atual, sem término. São geradas 6 despesas, com vencimentos no último dia em meses curtos.
  - **Gerar de novo:** cria 0.
  - **Apagar uma despesa gerada e gerar de novo:** cria 0.
  - **Editar a partir do mês+2:** muda as despesas do mês+2 em diante e não toca nas pagas.
  - **Encerrar no mês+3:** apaga as despesas do mês+4 e do mês+5.

- [ ] **Step 2: Navegador (Playwright).**
  - informar o saldo;
  - ver os cartões e os 8 meses;
  - criar uma despesa recorrente pela tela e ver a saída nos meses futuros;
  - abrir o dia a dia;
  - ver a linha "Em atraso";
  - encerrar a recorrência;
  - limpeza: despesas, recorrências e o saldo de teste. O saldo é apagado pelo id criado.

- [ ] **Step 3: Rodar `npx vitest run`.** Esperado: tudo passa.
