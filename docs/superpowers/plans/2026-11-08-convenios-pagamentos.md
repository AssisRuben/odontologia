# Convênios — etapa 7b (pagamento, glosas e recurso): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar o pagamento de cada lote enviado por item (pago, glosa com motivo da Tabela 38), acompanhar o recurso de glosa e lançar os recebimentos "Convênio" no Financeiro, um por paciente.

**Architecture:** Regras puras em `src/lib/convenios/pagamentos/**` (validação, cálculo, situação) e extensão de `src/lib/convenios/pendencias.ts`. Gravações que mexem em vários registros (pagamento do lote, desfazer, recebimento do recurso) são funções SQL transacionais com `FOR UPDATE`; as rotas (`withClinic`) validam antes e mapeiam os erros. Telas novas na página `/convenios` (aba Pagamentos) e ajustes na operadora, no lote e nas guias do paciente.

**Tech Stack:** Next.js 16, React 19, Supabase (Postgres, RLS, funções SQL), Vitest, `tests/fakeSupabase.ts`, PGlite (só verificação fora do repo).

**Spec:** `docs/superpowers/specs/2026-11-08-convenios-pagamentos-design.md` (depende da 7a: `docs/superpowers/specs/2026-11-07-convenios-guias-design.md`)

## Global Constraints

- Next.js 16: ler `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` e `page.md` antes de rotas/páginas; contexto de rota `ctx: RouteContext<'/api/...'>`; `useSearchParams` dentro de `Suspense`.
- Rotas com `withClinic` (`src/lib/ia/rotas.ts`); filtrar sempre por `clinic_id`; id não UUID → 422 `'Identificador inválido'`; de outra clínica → 404. Erros de banco mapeados por `erroDoBanco` (`src/lib/convenios/rotas.ts`), estendido nesta etapa.
- Datas de negócio `YYYY-MM-DD`; "hoje" = `todayYmd(new Date(), 'America/Sao_Paulo')`. `payments.paid_at` segue a convenção existente de `src/lib/payments/dates.ts`: `'{data}T12:00:00Z'` (no SQL: `(p_paid_at::text || 'T12:00:00Z')::timestamptz`).
- Padrões e faixas: `payment_days` e `appeal_days` padrão **30**, faixa **0–180**; prazo de recurso "vencendo" = ≤ **5** dias; recurso aceito sem recebimento há > **30** dias; pagos exibidos dos últimos **6** meses; observação da glosa ≤ **200**; justificativa do recurso 1–**2000**; motivo = código de **4 dígitos** existente em `glosa_reasons`; valores com no máximo 2 casas.
- Textos exatos:
  - descrição do recebimento do lote: `{operadora} — lote {mm/aaaa}` (mês de `period_end`); do recurso: `{operadora} — recurso de glosa {código}`;
  - erros: `'Lote não está aguardando pagamento'` (409), `'Lote não está pago'` (409), `'Informe todos os itens do lote'` (422), `'Informe o motivo da glosa'` (422), `'Motivo de glosa inválido'` (422), `'Há recurso com valor já recebido neste lote'` (409), `'Recurso não está aceito ou já foi recebido'` (409), `'Valor pago inválido'` (422), `'Valor recuperado inválido'` (422), `'Item não está glosado'` (409), `'Informe a justificativa'` (422), `'Data inválida'` (422), `'Item não encontrado'` (404), `'Lote não encontrado'` (404);
  - pendências: `Lote {operadora} {mm/aaaa}: pagamento atrasado há {n} {dia|dias}` (`href: /convenios?aba=pagamentos`); `Glosa de {paciente} ({código}): prazo de recurso em {n} {dia|dias}` / `prazo de recurso hoje` / `prazo de recurso vencido há {n} {dia|dias}` (mesmo href); `Recurso aceito de {paciente} sem recebimento há {n} dias` (mesmo href).
- Migração `supabase/2026-11-08-convenios-pagamentos.sql` re-executável, espelhada no fim de `supabase/schema.sql`. Carga **já existe**: `supabase/2026-11-08-motivos-glosa.sql` (470 motivos, Tabela 38 ANS 202609) — não regerar.
- Funções SQL: `SECURITY DEFINER SET search_path = public`, `p_clinic_id` primeiro, `REVOKE ... FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE ... TO service_role`, erros `RAISE EXCEPTION '<CODIGO>'`. A coluna `"authorization"` (7a) é palavra reservada: sempre entre aspas no SQL.
- Verificação SQL por execução no PGlite com o harness `C:/Users/Marcos/AppData/Local/Temp/claude/c--Workspace-odontologia/9b2f467b-ffd3-466c-916d-b93b91e1316b/scratchpad/pglite/verify.mjs` (schema do zero + migrações da 7a e da 7b duas vezes + cargas). Nunca adicionar pglite ao `package.json`.
- Logs sem nome de paciente, carteirinha, senha ou valores por paciente.
- Português do Brasil; estilo atual das telas de Convênios.

## Rulings sobre a spec

- **Hora do `paid_at`:** a spec diz "meio-dia de São Paulo"; o app inteiro usa meio-dia UTC (`toDbPaidAt`). Seguir a convenção existente — o dia fica certo em São Paulo do mesmo jeito.
- **`payments` criados:** `charge_kind 'manual'`, `status 'paid'`, `payment_method 'convenio'`, `due_date` = data do depósito, `budget_id`/`appointment_id` nulos.
- **Itens do lote no pagamento:** só itens com `batch_id` do lote; itens inativos que estejam no lote também precisam vir na lista (a função compara com todos os itens com `batch_id = p_batch_id`).
- **Recorrer e resultado** são `UPDATE`s simples pelas rotas (um item), condicionados por `appeal_status` atual e lote `'pago'`; só o recebimento usa função SQL (cria `payments`).
- **Desfazer** cancela também recebimentos de recurso? Não: se houver `recovered_payment_id`, desfazer é recusado (`RECURSO_RECEBIDO`).

## Review Focus

1. **Paciente com todos os itens glosados** → nenhum recebimento de R$ 0,00; os demais pacientes recebem. → Task 1 (PGlite) e Task 2 (`agruparPorPaciente ignora soma zero`).
2. **Dois cliques em salvar pagamento** → um só conjunto de recebimentos; o segundo recebe 409. → Task 1 (PGlite: segunda chamada → `LOTE_NAO_ENVIADO`) e Task 4 (`segundo registro devolve 409`).
3. **Valor pago com vírgula ou acima do enviado** ("150,00" num item de R$ 100) → recusado com `'Valor pago inválido'`, nada gravado. → Task 2 (`pago acima do enviado`).
4. **Desfazer depois de registrar recebimento de recurso** → recusado, recebimentos intactos. → Task 1 (PGlite) e Task 4 (`desfazer com recurso recebido → 409`).
5. **Livro-caixa do mês do depósito** → os recebimentos aparecem como "convênio" na data do depósito (não no dia seguinte). → Task 4 (`recebimento usa paid_at T12:00:00Z e método convenio`).

---

## File Structure

```
supabase/2026-11-08-convenios-pagamentos.sql      (novo) migração + funções
supabase/2026-11-08-motivos-glosa.sql             (já existe) carga Tabela 38
supabase/schema.sql                               (mod) espelho
src/types/index.ts                                (mod) tipos novos
src/lib/convenios/pagamentos/validar.ts           (novo) validações (puro)
src/lib/convenios/pagamentos/calculo.ts           (novo) totais, prazos, agrupamento (puro)
src/lib/convenios/pagamentos/situacao.ts          (novo) situação final do item (puro)
src/lib/convenios/pendencias.ts                   (mod) novos tipos de pendência
src/lib/convenios/repo.ts, rotas.ts               (mod) dados e erros novos
src/app/api/convenios/pagamentos/route.ts         (novo) GET
src/app/api/convenios/lotes/[id]/pagamento/route.ts  (novo) POST/DELETE
src/app/api/convenios/itens/[id]/recurso/**       (novo) recorrer, resultado, recebimento
src/app/api/convenios/motivos/route.ts            (novo) busca Tabela 38
src/components/convenios/AbaPagamentos.tsx, ModalPagamentoLote.tsx, ModalRecurso.tsx (novos)
src/components/convenios/PainelOperadora.tsx, AbaLotes.tsx (mod)
src/app/(dashboard)/convenios/page.tsx            (mod) aba Pagamentos
src/components/paciente/SecaoGuias.tsx            (mod) situação final
README.md                                         (mod)
```

### Task 1: Banco e tipos

**Files:**
- Create: `supabase/2026-11-08-convenios-pagamentos.sql`
- Modify: `supabase/schema.sql`, `src/types/index.ts`

**Interfaces:**
- Produces:
  - SQL exatamente como a spec §Banco e §Funções, com os rulings acima: colunas novas (`payment_days`, `appeal_days`, `paid_at`, `deposit_amount`, `paid_registered_at`, colunas de pagamento e recurso no item), `glosa_reasons` com RLS `SELECT` para `authenticated`, CHECK de status do lote com `'pago'` (drop/recreate da constraint da 7a), CHECKs de valor do item, índice `insurance_guide_items (clinic_id, appeal_status)`, funções `register_batch_payment`, `undo_batch_payment`, `receive_appeal` com os códigos de erro da spec.
  - `register_batch_payment` valida que o conjunto de ids em `p_items` é igual ao conjunto de itens com `batch_id = p_batch_id` (`ITENS_INCOMPLETOS`), que `paid_value` está entre 0 e `value` (`VALOR_INVALIDO`, mapeado para `'Valor pago inválido'`), e que glosa > 0 tem `glosa_code` (`MOTIVO_OBRIGATORIO`); grava `glosa_value = value - paid_value`, zera `glosa_code`/`glosa_note` quando glosa = 0; cria recebimentos por paciente (`guide.patient_id`) com soma > 0; `paid_registered_at = NOW()`.
  - `types`: `InsurancePlan` ganha `payment_days: number; appeal_days: number`; `BatchStatus` ganha `'pago'`; `InsuranceBatch` ganha `paid_at: string | null; deposit_amount: number | null`; `InsuranceGuideItem` ganha `paid_value`, `glosa_value`, `glosa_code`, `glosa_note`, `payment_id`, `appeal_status: AppealStatus`, `appeal_at`, `appeal_text`, `appeal_result_at`, `recovered_value`, `recovered_payment_id`; novos `AppealStatus = 'nenhum' | 'em_recurso' | 'aceito' | 'negado'` e `GlosaReason { code: string; name: string }`.
- [ ] **Step 1:** escrever a migração e o espelho.
- [ ] **Step 2: Verificar por execução (PGlite):** schema do zero; migração 7a + 7b duas vezes; cargas TUSS e motivos duas vezes (470 linhas). Cenários: lote enviado com 3 itens de 2 pacientes, um paciente 100% glosado → `register_batch_payment` cria 1 recebimento, lote `'pago'`, valores gravados; segunda chamada → `LOTE_NAO_ENVIADO`; lista faltando item → `ITENS_INCOMPLETOS`; glosa sem motivo → `MOTIVO_OBRIGATORIO`; pago > valor → `VALOR_INVALIDO`; motivo inexistente → FK `23503`; `undo_batch_payment` → recebimento `cancelled`, lote `'enviado'`, itens limpos; após aceitar recurso (UPDATE manual) `receive_appeal` cria recebimento e liga; `undo` depois disso → `RECURSO_RECEBIDO`; segunda `receive_appeal` → `RECURSO_INVALIDO`; funções executáveis só por `service_role`.
- [ ] **Step 3:** `npx tsc --noEmit -p .`; commit `feat(convenios): banco do pagamento de lotes e recurso de glosa`.

### Task 2: Regras puras de pagamento

**Files:**
- Create: `src/lib/convenios/pagamentos/validar.ts`, `calculo.ts`, `situacao.ts`
- Test: `tests/convenios/pagamentos/validar.test.ts`, `calculo.test.ts`, `situacao.test.ts`

**Interfaces:**
- Consumes: Task 1 (tipos); `dataValida` de `src/lib/convenios/cadastro.ts`; `diasEntre`, `prazo` de `periodo.ts`.
- Produces:
  - `validar.ts`:
    - `type ItemPagamento = { id: string; paidValue: number; glosaCode: string | null; glosaNote: string | null }`; `validarPagamento(raw: unknown, itensDoLote: { id: string; value: number }[]): { ok: true; dados: { paidAt: string; deposit: number; itens: ItemPagamento[] } } | { ok: false; error: string; status: 422 }` — mesmo conjunto de ids (`'Informe todos os itens do lote'`); `0 ≤ paidValue ≤ value`, 2 casas (`'Valor pago inválido'`); glosa > 0 exige `glosaCode` `^\d{4}$` (`'Informe o motivo da glosa'`); glosa = 0 zera código e nota; nota ≤ 200; `paidAt` válida (`'Data inválida'`); `deposit ≥ 0`, 2 casas.
    - `validarRecurso(raw)` → `{ appealAt, appealText }` (`'Informe a justificativa'` para vazio ou > 2000; data).
    - `validarResultado(raw, glosaValue: number)` → `{ resultado: 'aceito' | 'negado'; resultAt: string; recoveredValue: number | null; receivedAt: string | null }` — aceito exige `0 < recoveredValue ≤ glosaValue` (`'Valor recuperado inválido'`); negado ignora valor/recebimento.
    - `validarRecebimento(raw, recoveredValue: number)` → `{ value: number; receivedAt: string }` (valor padrão = `recoveredValue`; `0 < value ≤ recoveredValue`).
  - `calculo.ts`: `glosaDe(value, paid): number`; `totaisLote(itens: { value: number; paid_value: number | null }[], deposit: number | null): { enviado: number; pago: number; glosado: number; diferenca: number | null }` (centavos inteiros internamente; `diferenca = deposit − pago`); `agruparPorPaciente(itens: { patient_id: string; paid_value: number }[]): { patient_id: string; total: number }[]` (omite total 0); `dataPrevista(sentAt: string, paymentDays: number): string`; `prazoRecurso(paidAt: string, appealDays: number): string`.
  - `situacao.ts`: `situacaoPagamento(item: { paid_value: number | null; glosa_value: number | null; appeal_status: AppealStatus; recovered_value: number | null; recovered_payment_id: string | null }): 'aguardando' | 'pago' | 'glosado' | 'em_recurso' | 'recuperado' | 'glosa_definitiva' | 'aceito_aguardando'` e `rotuloSituacao(s): string` com `'Aguardando pagamento' | 'Pago' | 'Glosado' | 'Em recurso' | 'Recuperado' | 'Glosa definitiva' | 'Aceito — aguardando pagamento'`.
- [ ] **Step 1: Testes:** **`pago acima do enviado`** (150 em item de 100 → `'Valor pago inválido'`); 12.345 → inválido; faltando item → `'Informe todos os itens do lote'`; glosa sem motivo → erro; motivo `'17'` → erro; glosa 0 com motivo → motivo descartado; `totaisLote` com 0,1 + 0,2 sem erro de ponto flutuante (0,3); **`agruparPorPaciente ignora soma zero`**; `dataPrevista('2026-11-07', 30)` → `'2026-12-07'`; resultado aceito com recuperado > glosado → erro; negado → `recoveredValue: null`; cada situação e rótulo (glosa 0 → `pago`; glosa > 0 sem recurso → `glosado`; aceito sem recebimento → `aceito_aguardando`; aceito com recebimento → `recuperado`; negado → `glosa_definitiva`; `paid_value` nulo → `aguardando`).
- [ ] **Step 2–4:** rodar (FAIL), implementar, rodar (PASS).
- [ ] **Step 5: Commit** `feat(convenios): regras de pagamento, glosa e recurso`.

### Task 3: Pendências de pagamento e recurso

**Files:**
- Modify: `src/lib/convenios/pendencias.ts`, `src/lib/convenios/repo.ts` (`dadosPendencias`), `src/app/api/convenios/pendencias/route.ts` se necessário
- Test: `tests/convenios/pendencias.test.ts`, `tests/convenios/repo.test.ts`

**Interfaces:**
- Consumes: Task 2 (`dataPrevista`, `prazoRecurso`).
- Produces:
  - `Pendencia['tipo']` ganha `'pagamento_atrasado' | 'recurso_prazo' | 'recurso_sem_recebimento'`; `montarPendencias` recebe também `lotesEnviados: { id; plan_name; period_end; sent_at; payment_days }[]` e `glosas: { item_id; patient_name; glosa_code; paid_at; appeal_days; appeal_status: AppealStatus; appeal_result_at: string | null; recovered_payment_id: string | null }[]`, com os textos exatos das Global Constraints e as regras: atrasado quando `hoje > dataPrevista` (lote `'enviado'`); `recurso_prazo` quando `appeal_status = 'nenhum'` e `diasEntre(hoje, prazoRecurso) ≤ 5`; `recurso_sem_recebimento` quando `aceito`, sem `recovered_payment_id` e `diasEntre(appeal_result_at, hoje) > 30`. Ordem: `pagamento_atrasado`, `recurso_prazo` antes dos tipos da 7a; `recurso_sem_recebimento` por último. `contador` soma também `pagamento_atrasado` e `recurso_prazo`.
  - `dadosPendencias` lê lotes `'enviado'` com `sent_at` e itens de lotes `'pago'` com glosa > 0 (paginado, filtrado por clínica; lotes pagos dos últimos 6 meses).
- [ ] **Step 1: Testes:** atrasado com 1 dia → `pagamento atrasado há 1 dia`; no dia previsto → não; prazo de recurso em 5 dias entra, 6 não; hoje → `prazo de recurso hoje`; vencido; em recurso não entra; aceito há 31 dias sem recebimento entra, 30 não; contador; ordem; repo filtra clínica e pagina.
- [ ] **Step 2–4:** rodar (FAIL), implementar, rodar (PASS).
- [ ] **Step 5: Commit** `feat(convenios): pendências de pagamento e recurso`.

### Task 4: Rotas de pagamento, recurso e motivos

**Files:**
- Create: `src/app/api/convenios/pagamentos/route.ts`, `src/app/api/convenios/lotes/[id]/pagamento/route.ts`, `src/app/api/convenios/itens/[id]/recurso/route.ts`, `.../recurso/resultado/route.ts`, `.../recurso/recebimento/route.ts`, `src/app/api/convenios/motivos/route.ts`
- Modify: `src/lib/convenios/repo.ts`, `src/lib/convenios/rotas.ts`
- Test: `tests/convenios/rotas-pagamentos.test.ts`, `tests/convenios/repo.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `erroDoBanco` ganha: `LOTE_NAO_ENVIADO`, `LOTE_NAO_PAGO`, `ITENS_INCOMPLETOS`, `MOTIVO_OBRIGATORIO`, `VALOR_INVALIDO`, `RECURSO_RECEBIDO`, `RECURSO_INVALIDO` e FK `23503` em `glosa_code` → `'Motivo de glosa inválido'` (status/textos das Global Constraints).
  - `repo`: `itensDoLote(clinicId, batchId)` (`id, value, status do lote`); `registrarPagamento(clinicId, batchId, dados)` (RPC); `desfazerPagamento`; `itemRecurso(clinicId, itemId)` (`id, glosa_value, appeal_status, recovered_value, recovered_payment_id, status do lote`); `recorrer`, `registrarResultado` (UPDATE condicionado ao `appeal_status` esperado — 0 linhas → 409 `'Item não está glosado'` ou `'Recurso não está aceito ou já foi recebido'`); `receberRecurso` (RPC); `pagamentos(clinicId, hoje)` → `{ aguardando: [...], glosas: [...], pagos: [...] }` com totais via `totaisLote`, `dataPrevista`, `prazoRecurso`; `buscarMotivos(q)` (dígitos → prefixo do código; senão `name ilike`; até 20; `q` com 2+ caracteres).
  - Rotas conforme a spec §Rotas; `POST pagamento` valida com `validarPagamento` antes da RPC; `resultado` aceito com `receivedAt` chama `receberRecurso` após gravar `aceito`.
- [ ] **Step 1: Testes:** id não UUID → 422; **`segundo registro devolve 409`** (RPC `LOTE_NAO_ENVIADO`); itens incompletos → 422; **`desfazer com recurso recebido → 409`**; recorrer item com glosa 0 → 409 `'Item não está glosado'`; resultado aceito com `receivedAt` chama RPC; recebimento duplicado → 409; motivos com `'17'` busca por prefixo e `'carteira'` por nome; GET pagamentos separa aguardando/glosas/pagos e filtra clínica; **`recebimento usa paid_at T12:00:00Z e método convenio`** (asserção sobre os parâmetros passados à RPC: `p_paid_at` = `'2026-11-07'`, e no PGlite da Task 1 o `paid_at` gravado lê `2026-11-07` com `fromDbPaidAt`).
- [ ] **Step 2–4:** rodar (FAIL), implementar, rodar (PASS) + `npx tsc --noEmit -p .` + `npx vitest run`.
- [ ] **Step 5: Commit** `feat(convenios): rotas de pagamento, recurso e motivos de glosa`.

### Task 5: Telas de pagamento e recurso

**Files:**
- Create: `src/components/convenios/AbaPagamentos.tsx`, `ModalPagamentoLote.tsx`, `ModalRecurso.tsx`
- Modify: `src/app/(dashboard)/convenios/page.tsx` (aba `pagamentos`), `src/components/convenios/AbaLotes.tsx` (botão "Registrar pagamento" em lote enviado; lote pago mostra data e totais), `src/components/convenios/PainelOperadora.tsx` (prazos de pagamento e de recurso, validados 0–180)

**Interfaces:**
- Consumes: Task 4 (rotas), Task 2 (`totaisLote`, `glosaDe`, `rotuloSituacao`).
- Produces: UI da spec §Telas. Detalhes:
  - Modal de pagamento: data do depósito (padrão hoje), valor depositado (R$), botão "Tudo pago", linhas por item (paciente, código + nome, enviado, pago editável em R$, glosado calculado, motivo com busca em `/api/convenios/motivos` com debounce 300 ms e resultado antigo descartado, observação); rodapé com enviado / pago / glosado / depositado e aviso `Diferença de R$ X entre o depositado e a soma paga` quando ≠ 0; salvar desabilitado enquanto envia.
  - Aba Pagamentos: três blocos da spec; "Desfazer pagamento" com `window.confirm`; recurso: "Recorrer" (data + justificativa + botão "Copiar justificativa"), "Resultado" (aceito com valor recuperado e data de recebimento opcional / negado), "Registrar recebimento".
  - Toda mutação bem-sucedida dispara `window.dispatchEvent(new Event('convenios:changed'))`; erros mostram o `error` da rota.
- [ ] **Step 1:** implementar; `npx tsc --noEmit -p .`, `npx eslint` nos arquivos tocados.
- [ ] **Step 2: Commit** `feat(convenios): telas de pagamento de lote e recurso de glosa`.

### Task 6: Situação no paciente e README

**Files:**
- Modify: `src/components/paciente/SecaoGuias.tsx`, `src/components/paciente/TabTratamentos.tsx` (se os dados das guias precisarem das colunas novas), `README.md`

**Interfaces:**
- Consumes: Task 2 (`situacaoPagamento`, `rotuloSituacao`).
- Produces: cada item de guia em lote pago mostra o selo de situação; glosado mostra também o código do motivo; README — seção "Convênios" ganha "Pagamento e glosas": rodar `supabase/2026-11-08-convenios-pagamentos.sql` e depois `supabase/2026-11-08-motivos-glosa.sql`; prazos na operadora; registrar pagamento ("Tudo pago", glosa com motivo, conferência com depósito); recebimentos no Financeiro (um por paciente); recurso; desfazer; o que não faz.
- [ ] **Step 1:** implementar; `npx tsc --noEmit -p .`, `npx eslint` nos arquivos tocados, `npx vitest run`.
- [ ] **Step 2: Commit** `feat(convenios): situação de pagamento no paciente e README`.
