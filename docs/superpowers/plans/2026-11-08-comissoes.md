# Comissão dos dentistas (item 8): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calcular a comissão de cada dentista sobre o recebido (particular quitando tratamentos do mais antigo para o mais novo, convênio pelo item do lote), com descontos de taxa e laboratório, fechar o mês por dentista e lançar o pagamento como despesa.

**Architecture:** Cálculo inteiro em funções puras (`src/lib/comissoes/**`) sobre o histórico lido do banco; nada de comissão é gravado até o fechamento, que congela valor + extrato via função SQL. Pagar/desfazer/reabrir são funções SQL transacionais. Telas na aba Comissões do Financeiro (hoje vazia) e percentuais em Configurações → Profissionais.

**Tech Stack:** Next.js 16, React 19, Supabase (Postgres, RLS, funções SQL), Vitest, `tests/fakeSupabase.ts`, PGlite (só verificação fora do repo).

**Spec:** `docs/superpowers/specs/2026-11-08-comissoes-design.md`

## Global Constraints

- Next.js 16: ler `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` antes de rotas; contexto `ctx: RouteContext<'/api/...'>`; rodar `npx next typegen` depois de criar rotas novas.
- Rotas com `withClinic` (`src/lib/ia/rotas.ts`); filtrar sempre por `clinic_id`; id não UUID → 422 `'Identificador inválido'`; de outra clínica → 404. Erros SQL mapeados com `respostaDeErro(e, ERROS_COMISSAO)` (`src/lib/convenios/rotas.ts` aceita mapa próprio).
- Dinheiro em **centavos inteiros** em toda a lib, nas respostas das rotas e no `statement` JSONB (campos com sufixo `Centavos`); só o SQL recebe reais (`amount = totalCentavos / 100`). Arredondamento `Math.round`.
- Datas `YYYY-MM-DD`, mês `YYYY-MM`; "hoje" = `todayYmd(new Date(), 'America/Sao_Paulo')` (`src/lib/messaging/time.ts`); `paid_at` de `payments` e `expenses` lido com `fromDbPaidAt` e gravado com a convenção `'{data}T12:00:00Z'` (no SQL: `(p_paid_at::text || 'T12:00:00Z')::timestamptz`).
- Listas lidas com paginação (`lerTudo`, PostgREST corta em 1000).
- Textos exatos:
  - descrição da despesa: `Comissão — {nome do profissional} — {mm/aaaa}`; categoria `'comissoes'` com rótulo `'Comissões de dentistas'`, grupo `'custeio'`;
  - erros: `'O mês ainda não terminou'` (409, `MES_ABERTO`), `'Não há comissão a fechar neste mês'` (409, `VALOR_INVALIDO`), `'Este mês já foi fechado'` (409, `FECHAMENTO_EXISTE`), `'Há um mês posterior fechado; reabra-o antes'` (409, `FECHAMENTO_POSTERIOR`), `'Desfaça o pagamento antes de reabrir'` (409, `FECHAMENTO_PAGO`), `'Comissão já está paga'` (409, `FECHAMENTO_JA_PAGO`), `'Comissão não está paga'` (409, `FECHAMENTO_NAO_PAGO`), `'Fechamento não encontrado'` (404, `FECHAMENTO_INVALIDO`), `'Profissional não encontrado'` (404, `PROFISSIONAL_INVALIDO`), `'Mês inválido'` (422), `'Data inválida'` (422), `'Forma de pagamento inválida'` (422), `'Percentual inválido'` (422).
- Migração `supabase/2026-11-08-comissoes.sql` re-executável, espelhada no fim de `supabase/schema.sql`.
- Funções SQL: `SECURITY DEFINER SET search_path = public`, `p_clinic_id` primeiro, `pg_advisory_xact_lock(hashtext(p_professional_id::text))` (ou do profissional do fechamento), `REVOKE ... FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE ... TO service_role`, erros `RAISE EXCEPTION '<CODIGO>'`; "hoje" no SQL = `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date`. A coluna `"authorization"` da 7a é reservada (não é tocada aqui).
- Verificação SQL por execução no PGlite: novo script `verify-comissoes.mjs` copiado do padrão de `C:/Users/Marcos/AppData/Local/Temp/claude/c--Workspace-odontologia/9b2f467b-ffd3-466c-916d-b93b91e1316b/scratchpad/pglite/verify-7b.mjs` (schema do zero + migrações 7a, 7b e comissões duas vezes). Nunca adicionar pglite ao `package.json`.
- Logs sem nome de paciente nem valores por paciente. Português do Brasil; estilo atual das telas do Financeiro.

## Rulings sobre a spec

- **`lerTudo`** sai de `src/lib/convenios/repo.ts` para `src/lib/supabase/lerTudo.ts` (exportado, mesma assinatura); `convenios/repo.ts` passa a importá-lo. Sem mudança de comportamento.
- **Tratamento sem dentista** entra na quitação (consome o recebimento) mas não gera comissão — senão o dinheiro dele iria para outro dentista.
- **Situação de mês fechado:** a linha do resumo e o extrato usam o `statement` congelado; meses abertos são calculados na hora.
- **Fechar com total ≤ 0:** a rota responde 409 `'Não há comissão a fechar neste mês'` sem chamar a RPC; a RPC também recusa (`VALOR_INVALIDO`).
- **Desfazer pagamento** apaga a despesa (a tabela `expenses` não tem status cancelado).
- **Percentuais** salvos pelo navegador como os demais campos do profissional (padrão atual da tela), validados por `validarPercentual` e pelo CHECK do banco.

## Review Focus

1. **Recebimento de convênio entrando na quitação particular** (contaria duas vezes) → ignorado. → Task 2 (`recebimento convenio não quita tratamento particular`).
2. **Paciente pagou em outubro e o tratamento foi concluído em dezembro** → comissão em dezembro, não em outubro. → Task 2 (`adiantamento vira comissão na conclusão`).
3. **Estorno depois do fechamento** → mês seguinte com ajuste negativo; fechar com total negativo é recusado. → Task 2 (`estorno após fechamento vira ajuste negativo`) e Task 1 (PGlite `VALOR_INVALIDO`).
4. **Fechar o mês corrente** → 409 `'O mês ainda não terminou'`. → Task 1 (PGlite) e Task 3 (`fechar mês corrente → 409`).
5. **Tratamento sem dentista no meio da fila** → consome o recebimento, ninguém ganha por ele. → Task 2 (`tratamento sem dentista consome mas não comissiona`).

---

## File Structure

```
supabase/2026-11-08-comissoes.sql               (novo) migração + funções
supabase/schema.sql                             (mod) espelho
src/types/index.ts                              (mod) tipos novos
src/lib/livro-caixa/categorias.ts               (mod) categoria 'comissoes'
src/lib/supabase/lerTudo.ts                     (novo) paginação compartilhada
src/lib/convenios/repo.ts                       (mod) importa lerTudo
src/lib/comissoes/periodo.ts, alocacao.ts, calculo.ts, validar.ts   (novos, puros)
src/lib/comissoes/repo.ts, rotas.ts             (novos) leitura e mapa de erros
src/app/api/comissoes/route.ts                  (novo) GET resumo
src/app/api/comissoes/[profissionalId]/route.ts (novo) GET extrato
src/app/api/comissoes/fechamentos/route.ts      (novo) POST fechar
src/app/api/comissoes/fechamentos/[id]/route.ts (novo) DELETE reabrir
src/app/api/comissoes/fechamentos/[id]/pagamento/route.ts (novo) POST/DELETE
src/components/financeiro/AbaComissoes.tsx, ModalExtratoComissao.tsx, ModalPagarComissao.tsx (novos)
src/app/(dashboard)/financeiro/page.tsx         (mod) renderiza a aba
src/app/(dashboard)/configuracoes/profissionais/page.tsx (mod) percentuais
README.md                                       (mod)
```

### Task 1: Banco, tipos e categoria

**Files:**
- Create: `supabase/2026-11-08-comissoes.sql`
- Modify: `supabase/schema.sql`, `src/types/index.ts`, `src/lib/livro-caixa/categorias.ts`
- Test: `tests/livro-caixa/categorias.test.ts` (já existe; acrescentar casos)

**Interfaces:**
- Produces:
  - SQL exatamente como a spec §Banco e §Funções, com os erros das Global Constraints: colunas `commission_rate`/`commission_rate_insurance` em `professionals`; CHECK de `expenses.category` recriado com `'comissoes'`; tabela `commission_closings` com RLS `SELECT` para membros (`clinic_id IN (SELECT public.user_clinic_ids())`, como as policies existentes) e índice `(clinic_id, period)`; funções `close_commission(UUID, UUID, DATE, NUMERIC, JSONB) RETURNS UUID`, `reopen_commission(UUID, UUID) RETURNS VOID`, `pay_commission(UUID, UUID, DATE, TEXT) RETURNS UUID`, `undo_commission_payment(UUID, UUID) RETURNS VOID`. `close_commission` exige `p_period` no dia 1 (senão `PERIODO_INVALIDO`, mapeado para 422 `'Mês inválido'`). `pay_commission` valida `p_method` nos valores de `expenses.payment_method` (CHECK da tabela cobre). `FECHAMENTO_POSTERIOR` em `close` = existe fechamento do dentista com `period > p_period`; em `reopen` = existe com `period >` o do fechamento.
  - `types`: `Professional` ganha `commission_rate: number | null; commission_rate_insurance: number | null`; `ExpenseCategory` ganha `'comissoes'`; novos `CommissionClosingStatus = 'fechado' | 'pago'` e `CommissionClosing { id; clinic_id; professional_id; period: string; amount: number; statement: unknown; status: CommissionClosingStatus; closed_at: string; paid_at: string | null; payment_method: PaymentMethod | null; expense_id: string | null }`.
  - `categorias.ts`: `{ code: 'comissoes', label: 'Comissões de dentistas', group: 'custeio' }` antes de `'outras'`.
- [ ] **Step 1: Teste:** `categoryLabel('comissoes')` → `'Comissões de dentistas'`; `defaultGroup('comissoes')` → `'custeio'`. Rodar (FAIL).
- [ ] **Step 2:** escrever a migração, o espelho, os tipos e a categoria; rodar o teste (PASS).
- [ ] **Step 3: Verificar por execução (PGlite):** schema do zero; migrações duas vezes. Cenários (datas relativas ao "hoje" do PGlite): fechar mês passado com 408,00 → id, status `'fechado'`; de novo → `FECHAMENTO_EXISTE`; mês corrente → `MES_ABERTO`; valor 0 e −5 → `VALOR_INVALIDO`; dia ≠ 1 → `PERIODO_INVALIDO`; profissional de outra clínica → `PROFISSIONAL_INVALIDO`; fechar mês anterior ao fechado → `FECHAMENTO_POSTERIOR`; `pay_commission` → despesa paga com descrição `Comissão — Ana — 10/2026`, categoria `'comissoes'`, `deduction_group 'custeio'`, `paid_at` lido como a data dada, `professional_id`; segunda → `FECHAMENTO_JA_PAGO`; `reopen` pago → `FECHAMENTO_PAGO`; `undo_commission_payment` → despesa apagada, status `'fechado'`, campos limpos; segunda → `FECHAMENTO_NAO_PAGO`; `reopen` do mais antigo com um posterior → `FECHAMENTO_POSTERIOR`; `reopen` válido apaga; `expenses` aceita `'comissoes'`; funções executáveis só por `service_role`.
- [ ] **Step 4:** `npx tsc --noEmit -p .`; commit `feat(comissoes): banco, tipos e categoria de despesa`.

### Task 2: Regras puras do cálculo

**Files:**
- Create: `src/lib/comissoes/periodo.ts`, `alocacao.ts`, `calculo.ts`, `validar.ts`
- Test: `tests/comissoes/periodo.test.ts`, `alocacao.test.ts`, `calculo.test.ts`, `validar.test.ts`

**Interfaces:**
- Consumes: Task 1 (tipos); `isUuid` de `src/lib/ia/uuid.ts`; `dataValida` de `src/lib/convenios/cadastro.ts`.
- Produces:
  - `periodo.ts`: `mesValido(s: unknown): s is string` (`^\d{4}-(0[1-9]|1[0-2])$`); `mesDe(data: string): string`; `primeiroDia(mes): string`; `ultimoDia(mes): string`; `mesAnterior(mes): string`; `mesEncerrado(mes, hoje: string): boolean` (`ultimoDia(mes) < hoje`); `rotuloMes(mes): string` (`'11/2026'`).
  - `alocacao.ts`:
    - `type RecebimentoIn = { id: string; patient_id: string; amount: number; net_amount: number | null; payment_method: string | null; paid_at: string; created_at: string }` (só `status 'paid'` chega aqui; `amount` em reais);
    - `type TratamentoIn = { id: string; patient_id: string; professional_id: string | null; procedure: string; value: number; completed_at: string | null; created_at: string; em_guia: boolean }`;
    - `type ParteParticular = { treatment_id: string; payment_id: string; patient_id: string; professional_id: string | null; procedure: string; brutoCentavos: number; baseCentavos: number; data: string }`;
    - `alocarParticular(recebimentos: RecebimentoIn[], tratamentos: TratamentoIn[]): ParteParticular[]` — algoritmo da spec §Regras 1, por paciente; ignora `payment_method = 'convenio'`, tratamento `em_guia`, `value ≤ 0` ou sem `completed_at`; ordenações da spec; `baseCentavos = round(bruto × net_amount / amount)` quando `net_amount` não nulo e `amount > 0`; `data = max(paid_at, completed_at)`; devolve também partes com `professional_id` nulo.
  - `calculo.ts`:
    - `type ItemConvenioIn = { item_id: string; patient_id: string; professional_id: string | null; descricao: string; paid_value: number | null; pago_em: string | null; recovered_value: number | null; recuperado_em: string | null }` (`pago_em`/`recuperado_em` só preenchidos se o recebimento ligado está `paid`; o repo resolve o dentista tratamento → guia);
    - `type LaboratorioIn = { id: string; professional_id: string; description: string; amount: number; paid_at: string }`;
    - `type ProfissionalIn = { id: string; name: string; commission_rate: number | null; commission_rate_insurance: number | null }`;
    - `type FechamentoIn = { id: string; professional_id: string; period: string; amountCentavos: number; status: 'fechado' | 'pago'; closed_at: string; paid_at: string | null; payment_method: string | null; statement: Extrato }`;
    - `type EntradaCalculo = { recebimentos: RecebimentoIn[]; tratamentos: TratamentoIn[]; itensConvenio: ItemConvenioIn[]; laboratorio: LaboratorioIn[]; profissionais: ProfissionalIn[]; fechamentos: FechamentoIn[]; nomesPacientes: Record<string, string> }`;
    - `type Parte = { data: string; patient_id: string; paciente: string; descricao: string; origem: 'particular' | 'convenio' | 'recurso'; baseCentavos: number; percentual: number; comissaoCentavos: number }`; `type DescontoLab = { data: string; descricao: string; custoCentavos: number; percentual: number; descontoCentavos: number }`;
    - `type Extrato = { professional_id: string; nome: string; mes: string; percentual: number | null; percentualConvenio: number | null; partes: Parte[]; laboratorio: DescontoLab[]; particularBaseCentavos: number; convenioBaseCentavos: number; laboratorioCustoCentavos: number; comissaoMesCentavos: number; ajusteCentavos: number; totalCentavos: number }`;
    - `type ResumoDentista = { professional_id: string; nome: string; semPercentual: boolean; situacao: 'aberto' | 'fechado' | 'pago'; fechamento: Omit<FechamentoIn, 'statement'> | null } & Pick<Extrato, 'percentual' | 'percentualConvenio' | 'particularBaseCentavos' | 'convenioBaseCentavos' | 'laboratorioCustoCentavos' | 'comissaoMesCentavos' | 'ajusteCentavos' | 'totalCentavos'>`;
    - `extrato(e: EntradaCalculo, professionalId: string, mes: string): Extrato` — fechado → `statement` do fechamento; aberto → calcula: partes particulares do dentista + convênio (`paid_value > 0`, data `pago_em`) + recurso (`recovered_value > 0`, data `recuperado_em`) com percentual convênio (nulo → particular); desconto de laboratório; `ajusteCentavos` = soma de comissões e descontos com data < `primeiroDia(mes)` − soma `amountCentavos` dos fechamentos do dentista com `period < primeiroDia(mes)`; dentista sem `commission_rate` → tudo zero e listas vazias. Partes ordenadas por data, depois paciente.
    - `resumoMes(e: EntradaCalculo, mes: string): ResumoDentista[]` — um por profissional (ordem por nome).
  - `validar.ts`: `validarPercentual(raw: unknown, opcional: boolean): { ok: true; valor: number | null } | { ok: false; error: 'Percentual inválido' }` (número ou texto com vírgula; 0–100; até 2 casas; vazio só se opcional); `validarFechamento(raw)` → `{ professionalId, mes }` (`'Identificador inválido'` / `'Mês inválido'`, 422); `validarPagamentoComissao(raw)` → `{ paidAt, paymentMethod }` (`'Data inválida'`, `'Forma de pagamento inválida'` fora de `dinheiro | cartao_credito | cartao_debito | pix | boleto`).
- [ ] **Step 1: Testes** (valores exatos):
  - alocação: R$1.000 pagos, tratamentos A (Ana, R$600, concluído antes) e B (Bruno, R$600) → partes Ana 60000, Bruno 40000; pagamento parcial; **`adiantamento vira comissão na conclusão`** (pago 2026-10-05, concluído 2026-12-02 → data `2026-12-02`); crédito sobrando não gera parte; um recebimento quitando dois tratamentos e dois recebimentos quitando um; **`recebimento convenio não quita tratamento particular`**; tratamento `em_guia` ignorado; **`tratamento sem dentista consome mas não comissiona`** (aparece com `professional_id: null`, o seguinte só recebe o resto); fator líquido 100 → 97 dá base 9700; dois pacientes não se misturam.
  - cálculo: exemplo da spec (Ana 40%/30%, base particular 97000, convênio 20000, laboratório 10000 → `comissaoMesCentavos` 40800); percentual convênio nulo usa o particular; recurso entra na data do recebimento; **`estorno após fechamento vira ajuste negativo`** (outubro fechado em 40000, recebimento de outubro removido → dezembro `ajusteCentavos` −40000 se nada mais); mês anterior não fechado vira ajuste positivo; mês fechado devolve o `statement`; sem percentual → `semPercentual: true`, total 0; arredondamento (base 333 × 33,33% → 111).
  - período: `ultimoDia('2026-02')` → `'2026-02-28'`, `ultimoDia('2028-02')` → `'2028-02-29'`; `mesAnterior('2026-01')` → `'2025-12'`; `mesEncerrado('2026-11', '2026-11-30')` → false, `('2026-10','2026-11-01')` → true; `mesValido('2026-13')` → false.
  - validar: `'40,5'` → 40.5; `101`, `-1`, `'12,345'` → erro; vazio opcional → null, obrigatório → erro; forma `'convenio'` → erro.
- [ ] **Step 2–4:** rodar (FAIL), implementar, rodar (PASS).
- [ ] **Step 5: Commit** `feat(comissoes): regras do cálculo de comissão`.

### Task 3: Leitura e rotas

**Files:**
- Create: `src/lib/supabase/lerTudo.ts`, `src/lib/comissoes/repo.ts`, `src/lib/comissoes/rotas.ts`, as cinco rotas do File Structure
- Modify: `src/lib/convenios/repo.ts` (importa `lerTudo`)
- Test: `tests/comissoes/repo.test.ts`, `tests/comissoes/rotas.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `lerTudo<T>(pagina: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]>`.
  - `repo.ts`: `entradaCalculo(admin, clinicId): Promise<EntradaCalculo>` — lê, sempre por clínica e paginado: `payments` `status 'paid'` (`id, patient_id, amount, net_amount, payment_method, paid_at, created_at`; `paid_at` via `fromDbPaidAt`, sem data → ignorado); `treatments` `status 'completed'` com `completed_at`; ids de tratamentos com item ativo (`insurance_guide_items active`) → `em_guia`; itens de guia com `payment_id` ou `recovered_payment_id`, juntando `paid_at`/status dos recebimentos e o dentista (tratamento → guia); despesas `category 'laboratorio'`, `status 'paid'`, `professional_id` não nulo; profissionais; fechamentos (`amount` × 100 arredondado → `amountCentavos`); nomes dos pacientes envolvidos. `profissional(admin, clinicId, id)` → `ProfissionalIn | null`; `fecharMes(admin, clinicId, professionalId, mes, extrato)` (RPC `close_commission` com `p_period = primeiroDia(mes)`, `p_amount = totalCentavos / 100`, `p_statement = extrato`); `reabrir`, `pagar(…, paidAt, method)`, `desfazerPagamento` (RPCs).
  - `rotas.ts`: `ERROS_COMISSAO: Mapa` com os códigos/textos das Global Constraints (+ `PERIODO_INVALIDO` → 422 `'Mês inválido'`).
  - Rotas (spec §Rotas): `GET /api/comissoes?mes=` → `{ mes, hoje, encerrado: boolean, dentistas: ResumoDentista[] }`; `GET /api/comissoes/[profissionalId]?mes=` → `Extrato` (404 se o profissional não for da clínica); `POST /api/comissoes/fechamentos` → valida, calcula `extrato`, total ≤ 0 → 409, mês não encerrado → 409 (antes da RPC), RPC → 201 `{ id }`; `DELETE /api/comissoes/fechamentos/[id]` → 200; `POST …/pagamento` → valida, RPC → 201 `{ expenseId }`; `DELETE …/pagamento` → 200.
- [ ] **Step 1: Testes:** `mes` ausente ou `'2026-13'` → 422 `'Mês inválido'`; id não UUID → 422; GET resumo filtra clínica em todas as leituras e devolve os totais calculados; repo pagina (1000 + 1 linhas) e descarta recebimento de convênio só na quitação (continua lido para itens); extrato de profissional de outra clínica → 404; **`fechar mês corrente → 409`** sem chamar RPC; total 0 → 409 sem RPC; fechar válido chama `close_commission` com `p_amount` 408 e `p_period` `'2026-10-01'`; RPC `FECHAMENTO_EXISTE` → 409 `'Este mês já foi fechado'`; pagar com forma inválida → 422; pagar chama `pay_commission` com `p_paid_at` `'2026-11-05'`; `FECHAMENTO_PAGO` no reabrir → 409; erro desconhecido → 500. `tests/convenios` continuam passando após mover `lerTudo`.
- [ ] **Step 2–4:** rodar (FAIL), implementar, `npx next typegen`, rodar (PASS) + `npx tsc --noEmit -p .` + `npx vitest run`.
- [ ] **Step 5: Commit** `feat(comissoes): leitura e rotas de comissão`.

### Task 4: Telas e README

**Files:**
- Create: `src/components/financeiro/AbaComissoes.tsx`, `ModalExtratoComissao.tsx`, `ModalPagarComissao.tsx`
- Modify: `src/app/(dashboard)/financeiro/page.tsx` (`activeTab === 'comissoes' && <AbaComissoes />`), `src/app/(dashboard)/configuracoes/profissionais/page.tsx`, `README.md`

**Interfaces:**
- Consumes: Task 3 (rotas), Task 2 (`validarPercentual`, `rotuloMes`, `mesAnterior`).
- Produces: UI da spec §Telas. Detalhes:
  - Profissionais: dois campos no formulário existente ("% comissão particular", "% comissão convênio (opcional; vazio = igual ao particular)"), validados com `validarPercentual` antes de salvar; erro mostra `'Percentual inválido'`; lista mostra o % quando definido.
  - Aba Comissões: seletor de mês (padrão `mesAnterior(mesDe(hoje))`, setas ← →); tabela (dentista, particular, convênio, laboratório, ajustes, total, situação) com valores em R$ (`centavos / 100`, `toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })`); ações por linha: "Ver extrato"; "Fechar mês" só se `encerrado`, `situacao 'aberto'` e `totalCentavos > 0`; fechado → "Marcar como pago" e "Reabrir" (`window.confirm`); pago → "Desfazer pagamento" (`window.confirm`) e "Pago em dd/mm"; sem percentual → aviso "Sem percentual" com link `/configuracoes/profissionais`; rodapé com o total geral; mês corrente mostra aviso "Mês em andamento: valores parciais".
  - Extrato: tabela da spec, linha "Ajustes de meses anteriores", total; fechado mostra "Fechado em dd/mm/aaaa"; botão Imprimir (`window.print()`).
  - Modal pagar: data (padrão hoje) e forma de pagamento (Dinheiro, Pix, Cartão de crédito, Cartão de débito, Boleto); botão desabilitado enquanto envia.
  - Erros mostram o `error` da rota; após mutação, recarrega o resumo.
  - README: seção nova "## Comissões": rodar `supabase/2026-11-08-comissoes.sql`; configurar percentuais; como o cálculo funciona (recebido, mais antigo primeiro, adiantamento, convênio, taxa do Asaas, laboratório); fechar, pagar, desfazer, reabrir; ajustes; o que não faz (lista "Fora do escopo" da spec); confirmar com o contador a dedutibilidade.
- [ ] **Step 1:** implementar; `npx tsc --noEmit -p .`, `npx eslint` nos arquivos tocados, `npx vitest run`.
- [ ] **Step 2: Commit** `feat(comissoes): telas de comissão e README`.
