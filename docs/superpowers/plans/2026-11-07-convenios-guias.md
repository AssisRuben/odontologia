# Convênios — etapa 7a (operadoras, tabela, guias e lote do mês): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O consultório organiza o faturamento de convênios: tabela TUSS por operadora, guias com autorização por item a partir dos tratamentos, lote mensal montado sozinho, pendências e prazos — sem XML, o dentista digita no portal.

**Architecture:** Regras puras em `src/lib/convenios/**` (cadastro, período, guias, prontidão, lotes, divergência, pendências). Escritas de guias e lotes passam por rotas do servidor (`withClinic`) que chamam funções SQL transacionais (`SECURITY DEFINER`, trava de linha `FOR UPDATE` na guia/lote). Cadastros (operadora, tabela, carteirinha) continuam gravados pela tela com RLS + `CHECK` no banco. Leitura de guias pela tela via RLS (`SELECT` para membros).

**Tech Stack:** Next.js 16 (route handlers, páginas client), React 19, Supabase (Postgres, RLS, funções SQL), Vitest, `tests/fakeSupabase.ts`.

**Spec:** `docs/superpowers/specs/2026-11-07-convenios-guias-design.md`

## Global Constraints

- Next.js 16: ler `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` e `page.md` antes de rotas/páginas. Params de rota são `Promise` (`ctx: RouteContext<'/api/...'>`).
- Rotas autenticadas com `withClinic` (`src/lib/ia/rotas.ts`); sempre filtrar por `clinic_id`; id não UUID (`isUuid`) → 422 `'Identificador inválido'`; de outra clínica → 404.
- Datas de negócio são strings `YYYY-MM-DD`; "hoje" = `todayYmd(new Date(), 'America/Sao_Paulo')` (`src/lib/messaging/time.ts`). Aritmética de datas em UTC sobre a string (sem fuso).
- Limiares: guia aguardando > **7** dias; senha vencendo em ≤ **7** dias; lote com prazo em ≤ **3** dias; `submission_days` padrão **10**, faixa 0–90; `closing_day` 1–28; até **30** itens por guia; carteirinha ≤ 30 caracteres; código do prestador ≤ 30; código da tabela 1–20 (`^[A-Za-z0-9.\-]+$`); nome 1–200; valor 0–999999.99; número da guia e senha ≤ 40.
- Mensagens de erro (exatas): `'Registro ANS deve ter 6 dígitos'`, `'Dia de fechamento deve ser de 1 a 28'`, `'Prazo de envio deve ser de 0 a 90 dias'`, `'Código do prestador muito longo'`, `'Código inválido'`, `'Nome obrigatório'`, `'Valor inválido'`, `'Carteirinha muito longa'`, `'Data inválida'`, `'Escolha ao menos um tratamento'`, `'Máximo de 30 itens por guia'`, `'Tratamento não encontrado'`, `'Tratamento de outro paciente ou convênio'`, `'Tratamento fora da tabela do convênio'`, `'Tratamento cancelado'`, `'Tratamento já está em outra guia'`, `'Item não pertence à guia'`, `'Item não exige autorização'`, `'Informe o motivo da negativa'`, `'Guia cancelada'`, `'Guia com item em lote não pode ser alterada'`, `'Item em lote não pode ser alterado'`, `'Lote já enviado'`, `'Lote vazio'`, `'Informe o protocolo'`, `'Guia não encontrada'`, `'Lote não encontrado'`, `'Item não encontrado'`.
- Migração `supabase/2026-11-07-convenios-guias.sql` re-executável (`IF NOT EXISTS`, `DROP ... IF EXISTS` antes de `CREATE POLICY`/constraints, `CREATE OR REPLACE FUNCTION`), espelhada em `supabase/schema.sql`. A carga TUSS **já existe**: `supabase/2026-11-07-tuss-odontologia.sql` (370 códigos, Tabela 22 da ANS versão 202609, gerada pelo controlador) — não regerar; só citar no README.
- Funções SQL: `SECURITY DEFINER SET search_path = public`, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE ... TO service_role`; erros de regra com `RAISE EXCEPTION '<CODIGO>'` (chega como `P0001` com `message` = código). Códigos: `GUIA_INVALIDA`, `GUIA_CANCELADA`, `GUIA_EM_LOTE`, `LOTE_INVALIDO`, `LOTE_ENVIADO`, `LOTE_VAZIO`. Violação do índice único de tratamento ativo chega como `23505`.
- Logs nunca contêm nome de paciente, carteirinha, senha ou número de guia.
- Português do Brasil; estilo das telas atuais (`#3B82F6`, `#111827`, `#6B7280`, `#E5E7EB`, cards `rounded-xl border`).

## Rulings sobre a spec

- **Trava:** a spec cita `pg_advisory_xact_lock` por operadora; as funções usam `SELECT ... FOR UPDATE` na linha da guia/lote, que serializa as mesmas operações (montar, tirar, enviar, responder, cancelar) sem trava global. Custo se errado: duas montagens simultâneas de lotes diferentes da mesma operadora não se bloqueiam — inofensivo, porque `batch_id IS NULL` na atualização impede item em dois lotes.
- **Criação de lote:** `upsert` com `onConflict: 'insurance_plan_id,period_end', ignoreDuplicates: true` e releitura; o `UNIQUE` garante um lote por período.
- **Excluir operadora:** `insurance_guides.insurance_plan_id` e `insurance_batches.insurance_plan_id` com `ON DELETE RESTRICT`; a tela de convênios mostra `'Convênio com guias não pode ser excluído. Desative-o.'` quando o banco recusar (código `23503`).
- **Valor do item:** copiado de `treatments.value` (o tratamento já recebeu o valor da tabela e pode ter sido ajustado), não da tabela.
- **Resposta parcial:** a resposta pode trazer só parte dos itens; os não citados ficam como estão. Guia vira `liberada` quando nenhum item ativo está `pendente`.
- **Negado → autorizado:** permitido na mesma guia enquanto nenhum item estiver em lote; reativar pode bater no índice único (`23505` → `'Tratamento já está em outra guia'`).
- **Leitura pela tela:** guias e itens do paciente são lidos direto pelo cliente Supabase (RLS `SELECT`); lotes e pendências só pelas rotas (montagem no servidor).

## Review Focus

1. **Tratamento concluído antes do início do lote cujo período já foi enviado** → entra no próximo lote aberto, marcado "atrasado"; nunca em lote enviado. → Task 3 (`item de período enviado vai para o próximo aberto`).
2. **Dois cliques em "Marcar como enviado" ou montagem enquanto envia** → um só envio; nenhum item entra em lote enviado. → Task 5 (`enviar duas vezes devolve 409 na segunda`, `atribuir em lote enviado não grava`).
3. **Tratamento editado (dente/valor) depois de entrar na guia** → item mostra divergência e "Atualizar item" só fora de lote. → Task 2 (`divergências de dente e valor`) e Task 4 (`atualizar item em lote → 409`).
4. **Fechamento dia 28 com execução em 29/01, 30/12 e 31/12** → períodos `29/01–28/02` e `29/12–28/01` do ano seguinte. → Task 2 (`virada de mês e de ano`).
5. **Tratamento de convênio sem procedimento da tabela (lançado antes da 7a)** → aparece como "fora da tabela" nas pendências e não entra em guia. → Task 2 (`fora da tabela recusa`) e Task 3 (`pendência fora da tabela`).

---

## File Structure

```
supabase/2026-11-07-convenios-guias.sql          (novo) migração + funções
supabase/2026-11-07-tuss-odontologia.sql         (já existe) carga TUSS
supabase/schema.sql                              (mod) espelho
src/types/index.ts                               (mod) tipos novos
src/lib/convenios/cadastro.ts                    (novo) validação de cadastros (puro)
src/lib/convenios/periodo.ts                     (novo) período/prazo (puro)
src/lib/convenios/guias.ts                       (novo) criação/resposta de guia (puro)
src/lib/convenios/divergencia.ts                 (novo) item × tratamento (puro)
src/lib/convenios/prontidao.ts                   (novo) item pronto (puro)
src/lib/convenios/lotes.ts                       (novo) destino dos itens (puro)
src/lib/convenios/pendencias.ts                  (novo) pendências e contador (puro)
src/lib/convenios/repo.ts                        (novo) Supabase/RPC
src/lib/convenios/rotas.ts                       (novo) parse de corpo das rotas + mapa de erros
src/app/api/guias/**, src/app/api/convenios/**   (novo) rotas
src/app/(dashboard)/configuracoes/convenios/page.tsx  (mod) operadora + tabela
src/components/convenios/*                       (novo) componentes das telas
src/components/paciente/ModalEditarPaciente.tsx  (mod) carteirinha
src/components/paciente/TabTratamentos.tsx       (mod) procedimento da tabela + selo
src/components/paciente/SecaoGuias.tsx           (novo) guias do paciente
src/app/(dashboard)/convenios/page.tsx           (novo) Pendências + Lotes
src/components/layout/Navbar.tsx                 (mod) link + contador
README.md                                        (mod) seção Convênios
```

### Task 1: Banco, tipos e validação de cadastros

**Files:**
- Create: `supabase/2026-11-07-convenios-guias.sql`, `src/lib/convenios/cadastro.ts`
- Modify: `supabase/schema.sql`, `src/types/index.ts`
- Test: `tests/convenios/cadastro.test.ts`

**Interfaces:**
- Produces:
  - SQL exatamente como a spec §Banco (colunas, tabelas, índice único parcial `insurance_guide_items_treatment_active_idx ON insurance_guide_items (treatment_id) WHERE active`, `UNIQUE (insurance_plan_id, period_end)`, RLS da spec §Acesso), mais: ordem de criação `insurance_plan_procedures` → coluna `treatments.insurance_procedure_id` → `insurance_batches` → `insurance_guides` → `insurance_guide_items`; FKs de guia/lote para `insurance_plans` com `ON DELETE RESTRICT`; `patient_id` da guia `ON DELETE CASCADE`; `professional_id` `ON DELETE SET NULL`; índices `insurance_guide_items (batch_id)`, `insurance_guides (clinic_id, patient_id)`, `insurance_batches (clinic_id, status)`.
  - Trigger `treatments_completed_at` (`BEFORE INSERT OR UPDATE OF status`): `completed` → `completed_at = COALESCE(NEW.completed_at, CURRENT_DATE)`; outro status → `NULL`.
  - Funções (todas com `p_clinic_id UUID` primeiro, filtrando por ele):
    - `create_insurance_guide(p_clinic_id, p_patient_id, p_plan_id, p_professional_id, p_card TEXT, p_status TEXT, p_items JSONB) RETURNS UUID` — insere guia e itens (`p_items`: `[{ treatment_id, code, name, teeth, value, requires_authorization, authorization }]`).
    - `respond_insurance_guide(p_clinic_id, p_guide_id, p_number TEXT, p_password TEXT, p_valid_until DATE, p_items JSONB) RETURNS TEXT` — `FOR UPDATE` na guia; inexistente → `GUIA_INVALIDA`; cancelada → `GUIA_CANCELADA`; algum item com `batch_id` → `GUIA_EM_LOTE`; atualiza cada item citado (`authorization`, `denial_reason`, `active = authorization <> 'negado'`); grava número, senha, validade, `responded_at = NOW()`; status `liberada` se nenhum item ativo `pendente`, senão `aguardando`; devolve o status.
    - `cancel_insurance_guide(p_clinic_id, p_guide_id) RETURNS VOID` — mesmos erros; status `cancelada`, itens `active = false`.
    - `assign_batch_items(p_clinic_id, p_batch_id, p_item_ids UUID[]) RETURNS INT` — `FOR UPDATE` no lote; inexistente → `LOTE_INVALIDO`; enviado → `LOTE_ENVIADO`; `UPDATE ... SET batch_id = p_batch_id WHERE id = ANY(p_item_ids) AND clinic_id = p_clinic_id AND batch_id IS NULL AND active`; devolve linhas afetadas.
    - `remove_batch_item(p_clinic_id, p_batch_id, p_item_id, p_defer_until DATE) RETURNS VOID` — mesmos erros de lote; `batch_id = NULL, typed = false, defer_until = p_defer_until` só se o item estiver nesse lote.
    - `send_insurance_batch(p_clinic_id, p_batch_id, p_protocol TEXT, p_sent_at DATE) RETURNS VOID` — mesmos erros; sem itens → `LOTE_VAZIO`; `status = 'enviado'`.
  - `types`: `InsurancePlan` ganha `ans_registry: string | null; provider_code: string | null; closing_day: number | null; submission_days: number; active: boolean`; `Patient` ganha `insurance_card: string | null; insurance_card_valid_until: string | null`; `Treatment` ganha `insurance_procedure_id?: string | null; completed_at?: string | null`; novos `TussProcedure { code; name }`, `InsurancePlanProcedure { id; clinic_id; insurance_plan_id; code; name; value: number; requires_authorization: boolean; active: boolean; created_at }`, `GuideStatus = 'aguardando' | 'liberada' | 'cancelada'`, `ItemAuthorization = 'pendente' | 'autorizado' | 'negado' | 'nao_exige'`, `GuideTooth = { tooth: number; faces: string[] }`, `InsuranceGuide`, `InsuranceGuideItem`, `BatchStatus = 'aberto' | 'enviado'`, `InsuranceBatch` (campos da spec).
  - `cadastro.ts`:
    - `validarOperadora(raw: unknown): { ok: true; dados: { ans_registry: string | null; provider_code: string | null; closing_day: number | null; submission_days: number; active: boolean } } | { ok: false; error: string }` — strings vazias viram `null`; `submission_days` ausente → 10.
    - `validarItemTabela(raw: unknown): { ok: true; dados: { code: string; name: string; value: number; requires_authorization: boolean } } | { ok: false; error: string }` — `trim`; valor com no máximo 2 casas.
    - `validarCarteirinha(raw: unknown): { ok: true; dados: { insurance_card: string | null; insurance_card_valid_until: string | null } } | { ok: false; error: string }`.
    - `situacaoCarteirinha(card: string | null, validUntil: string | null, hoje: string): 'ok' | 'vazia' | 'vencida'` — vencida quando `validUntil < hoje`.
- [ ] **Step 1: Testes:** `ans_registry: '12345'` → `'Registro ANS deve ter 6 dígitos'`; `'123456'` ok; `closing_day: 29` → erro; `0` → erro; `submission_days` ausente → 10, `91` → erro; strings vazias → `null`; item `code: '81000065'` ok, `'81 00'` → `'Código inválido'`, nome vazio → `'Nome obrigatório'`, `value: -1` e `12.345` → `'Valor inválido'`; carteirinha de 31 caracteres → `'Carteirinha muito longa'`; validade `'2026-02-30'` → `'Data inválida'`; `situacaoCarteirinha(null, null, h)` → `'vazia'`, validade ontem → `'vencida'`, hoje → `'ok'`.
- [ ] **Step 2–4:** rodar `npx vitest run tests/convenios/cadastro.test.ts` (FAIL), implementar, rodar (PASS) + `npx tsc --noEmit -p .`.
- [ ] **Step 5: Commit** `feat(convenios): migração, tipos e validação de cadastros`.

### Task 2: Período, guias e divergência

**Files:**
- Create: `src/lib/convenios/periodo.ts`, `src/lib/convenios/guias.ts`, `src/lib/convenios/divergencia.ts`
- Test: `tests/convenios/periodo.test.ts`, `tests/convenios/guias.test.ts`, `tests/convenios/divergencia.test.ts`

**Interfaces:**
- Consumes: Task 1 (tipos).
- Produces:
  - `periodo.ts`: `periodoDe(data: string, closingDay: number): { start: string; end: string }` (fim = primeiro dia `closingDay` ≥ `data`; início = dia seguinte ao fechamento anterior); `proximoPeriodo(end: string, closingDay: number): { start: string; end: string }`; `prazo(end: string, submissionDays: number): string`; `diasEntre(de: string, ate: string): number` (`ate − de` em dias).
  - `guias.ts`:
    - `type TratamentoParaGuia = { id: string; patient_id: string; insurance_plan_id: string | null; status: TreatmentStatus; value: number; teeth: GuideTooth[]; procedimento: { code: string; name: string; requires_authorization: boolean } | null; emGuiaAtiva: boolean }`.
    - `validarCriacaoGuia(input: { patientId: string; insurancePlanId: string; treatmentIds: string[] }, tratamentos: TratamentoParaGuia[]): { ok: true } | { ok: false; error: string }` — na ordem: lista vazia; > 30; id sem tratamento; outro paciente/convênio; `procedimento` nulo; `cancelled`; `emGuiaAtiva`.
    - `type ItemNovo = { treatment_id: string; code: string; name: string; teeth: GuideTooth[]; value: number; requires_authorization: boolean; authorization: 'pendente' | 'nao_exige' }`; `montarItens(tratamentos: TratamentoParaGuia[]): ItemNovo[]`; `statusInicial(itens: ItemNovo[]): 'aguardando' | 'liberada'`.
    - `type RespostaGuia = { guideNumber: string | null; password: string | null; passwordValidUntil: string | null; itens: { id: string; authorization: 'autorizado' | 'negado'; denialReason: string | null }[] }`; `validarResposta(raw: unknown, itensDaGuia: { id: string; requires_authorization: boolean }[]): { ok: true; resposta: RespostaGuia } | { ok: false; error: string }` — item fora da guia; item com `requires_authorization = false`; negado sem motivo (motivo ≤ 200); número/senha ≤ 40; data inválida.
  - `divergencia.ts`: `divergencias(item: { code: string; value: number; teeth: GuideTooth[] }, trat: { code: string | null; value: number; teeth: GuideTooth[] } | null): ('procedimento' | 'valor' | 'dentes')[]` — `trat` nulo → `[]`; dentes comparados ordenados por número e faces ordenadas; valor com tolerância 0,005.
- [ ] **Step 1: Testes:** **`virada de mês e de ano`**: `periodoDe('2026-01-29', 28)` → `{ start: '2026-01-29', end: '2026-02-28' }`; `periodoDe('2026-12-30', 28)` → `{ start: '2026-12-29', end: '2027-01-28' }`; `periodoDe('2026-03-10', 10)` → `{ start: '2026-02-11', end: '2026-03-10' }`; `proximoPeriodo('2026-03-10', 10)` → `{ start: '2026-03-11', end: '2026-04-10' }`; `prazo('2026-03-10', 10)` → `'2026-03-20'`; `diasEntre('2026-03-10','2026-03-13')` → 3. Guias: cada erro da lista na ordem; **`fora da tabela recusa`** (`procedimento: null` → `'Tratamento fora da tabela do convênio'`); itens copiam `value` do tratamento; todos sem autorização → `liberada`; um exige → `aguardando` com esse `pendente` e o outro `nao_exige`; resposta com id estranho → `'Item não pertence à guia'`; negado sem motivo → `'Informe o motivo da negativa'`; item `nao_exige` → `'Item não exige autorização'`. **`divergências de dente e valor`**: dentes `[{16,['M']}]` × `[{16,['M','O']}]` → `['dentes']`; valor 100 × 120 → `['valor']`; mesma ordem diferente de dentes → `[]`.
- [ ] **Step 2–4:** rodar (FAIL), implementar, rodar (PASS).
- [ ] **Step 5: Commit** `feat(convenios): período, guias e divergência`.

### Task 3: Prontidão, lotes e pendências

**Files:**
- Create: `src/lib/convenios/prontidao.ts`, `src/lib/convenios/lotes.ts`, `src/lib/convenios/pendencias.ts`
- Test: `tests/convenios/prontidao.test.ts`, `tests/convenios/lotes.test.ts`, `tests/convenios/pendencias.test.ts`

**Interfaces:**
- Consumes: Task 2 (`periodoDe`, `proximoPeriodo`, `prazo`, `diasEntre`).
- Produces:
  - `prontidao.ts`: `itemPronto(item: { active: boolean; authorization: ItemAuthorization; batch_id: string | null }, trat: { status: TreatmentStatus } | null): boolean`; `dataExecucao(item: { executed_at: string | null }, trat: { completed_at: string | null } | null): string | null`.
  - `lotes.ts`:
    - `destinoDoItem(execucao: string, deferUntil: string | null, closingDay: number, lotes: { period_end: string; status: BatchStatus }[]): { start: string; end: string }` — base `periodoDe(max(execucao, deferUntil), closingDay)`; enquanto existir lote com esse `end` e `status = 'enviado'`, avança com `proximoPeriodo`.
    - `planejarLotes(args: { closingDay: number; submissionDays: number; itens: { id: string; execucao: string; defer_until: string | null }[]; lotes: { id: string; period_end: string; status: BatchStatus }[] }): { criar: { period_start: string; period_end: string; due_date: string }[]; atribuir: { itemId: string; period_end: string }[] }` — `criar` sem repetir períodos nem os que já existem.
    - `atrasado(execucao: string, periodStart: string): boolean`; `adiarAte(periodEnd: string, closingDay: number): string` (= início do período seguinte).
  - `pendencias.ts`: `type Pendencia = { tipo: 'guia_aguardando' | 'senha_vencendo' | 'tratamento_sem_faturar' | 'lote_prazo' | 'operadora_sem_fechamento'; texto: string; href: string }`; `montarPendencias(args: { hoje: string; guias: { id: string; patient_id: string; patient_name: string; plan_name: string; status: GuideStatus; requested_at: string; password_valid_until: string | null; temItemSemLote: boolean }[]; tratamentos: { id: string; patient_id: string; patient_name: string; procedure: string; situacao: 'sem_guia' | 'pendente' | 'fora_tabela' }[]; lotes: { id: string; plan_name: string; period_end: string; status: BatchStatus; due_date: string }[]; operadorasSemFechamento: { id: string; name: string }[] }): { itens: Pendencia[]; contador: number }` — textos exatos:
    - `Guia de {paciente} ({operadora}) aguardando autorização há {n} dias` (n > 7), `href: /pacientes/{patient_id}?aba=tratamentos`;
    - `Senha da guia de {paciente} vence em {dd/mm}` (0 ≤ dias ≤ 7) ou `Senha da guia de {paciente} venceu em {dd/mm}`, só se `temItemSemLote`, mesmo href;
    - `{procedimento} de {paciente}: concluído sem guia` | `concluído aguardando autorização` | `fora da tabela do convênio`, mesmo href;
    - `Lote {operadora} {mm/aaaa}: prazo em {n} dias` (0 ≤ n ≤ 3; n = 0 → `prazo hoje`) ou `Lote {operadora} {mm/aaaa}: prazo vencido há {n} dias`, `href: /convenios?aba=lotes&lote={id}`; `{mm/aaaa}` = mês de `period_end`;
    - `{operadora} sem dia de fechamento`, `href: /configuracoes/convenios`;
    - ordem: lote_prazo, tratamento_sem_faturar, guia_aguardando, senha_vencendo, operadora_sem_fechamento; `contador` = quantidade de `tratamento_sem_faturar` + `lote_prazo`.
- [ ] **Step 1: Testes:** `itemPronto` falso para inativo, `pendente`, `negado`, com lote, tratamento não concluído ou nulo; verdadeiro para `autorizado`/`nao_exige` concluído. `dataExecucao` prefere `executed_at`. **`item de período enviado vai para o próximo aberto`** (execução 05/03, fechamento 10, lote `2026-03-10` enviado → destino `2026-04-10`); `defer_until` posterior empurra o período; `planejarLotes` com 3 itens em 2 períodos e um lote existente → `criar` só o que falta e `due_date = prazo(...)`; `atrasado('2026-02-05','2026-02-11')` verdadeiro. Pendências: guia com 8 dias entra e com 7 não; senha vencida há 1 dia entra; lote com prazo em 3 dias entra e 4 não; prazo hoje → texto `prazo hoje`; **`pendência fora da tabela`**; contador soma só tratamentos e lotes; ordem dos tipos.
- [ ] **Step 2–4:** rodar (FAIL), implementar, rodar (PASS).
- [ ] **Step 5: Commit** `feat(convenios): prontidão, lotes e pendências`.

### Task 4: Repositório e rotas de guias

**Files:**
- Create: `src/lib/convenios/repo.ts`, `src/lib/convenios/rotas.ts`, `src/app/api/guias/route.ts`, `src/app/api/guias/[id]/resposta/route.ts`, `src/app/api/guias/[id]/cancelar/route.ts`, `src/app/api/guias/itens/[id]/route.ts` (PATCH), `src/app/api/guias/itens/[id]/atualizar/route.ts` (POST)
- Test: `tests/convenios/repo.test.ts`, `tests/convenios/rotas-guias.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `rotas.ts`: `parseCriarGuia(raw): { ok: true; input: { patientId; insurancePlanId; professionalId: string | null; treatmentIds: string[] } } | { ok: false; error }` (ids UUID); `parseExecutado(raw): { ok: true; executedAt: string } | { ok: false; error }`; `parseEnvio(raw): { ok: true; protocol: string; sentAt: string } | { ok: false; error }` (protocolo 1–60, vazio → `'Informe o protocolo'`); `parseItemLote(raw): { ok: true; acao: { typed: boolean } | { remover: true } } | { ok: false; error }`; `erroDoBanco(e: { code?: string; message?: string }): { status: number; error: string } | null` — `GUIA_INVALIDA` → 404 `'Guia não encontrada'`; `GUIA_CANCELADA` → 409 `'Guia cancelada'`; `GUIA_EM_LOTE` → 409 `'Guia com item em lote não pode ser alterada'`; `LOTE_INVALIDO` → 404 `'Lote não encontrado'`; `LOTE_ENVIADO` → 409 `'Lote já enviado'`; `LOTE_VAZIO` → 409 `'Lote vazio'`; `23505` → 409 `'Tratamento já está em outra guia'`; outro → `null` (rota lança → 500).
  - `repo.ts` (`createConveniosRepo(admin: SupabaseClient)`), métodos usados pelas Tasks 4–5:
    - `tratamentosParaGuia(clinicId, treatmentIds): Promise<TratamentoParaGuia[]>` (join `insurance_plan_procedures` ativo e `treatment_teeth`; `emGuiaAtiva` por consulta a itens `active`);
    - `paciente(clinicId, patientId): Promise<{ insurance_card: string | null } | null>`;
    - `criarGuia(clinicId, args: { patientId; planId; professionalId: string | null; card: string | null; status; itens: ItemNovo[] }): Promise<string>` (RPC `create_insurance_guide`);
    - `itensDaGuia(clinicId, guideId): Promise<{ id; requires_authorization; batch_id }[] | null>` (null = guia inexistente);
    - `responderGuia(clinicId, guideId, r: RespostaGuia): Promise<GuideStatus>`; `cancelarGuia(clinicId, guideId): Promise<void>`;
    - `item(clinicId, itemId): Promise<{ id; batch_id; treatment_id } | null>`; `atualizarItem(clinicId, itemId, dados: { code; name; teeth; value }): Promise<void>` (condicionado a `batch_id IS NULL`; 0 linhas → 409 `'Item em lote não pode ser alterado'`); `corrigirExecucao(clinicId, itemId, executedAt): Promise<boolean>` (mesma condição).
    - Erros de RPC são relançados como objeto `{ code, message }` para `erroDoBanco`.
  - Rotas (corpos e respostas):
    - `POST /api/guias` → 201 `{ id, status }`; valida com `validarCriacaoGuia`; `card` copiado do paciente.
    - `POST /api/guias/[id]/resposta` → 200 `{ status }`.
    - `POST /api/guias/[id]/cancelar` → 200 `{ ok: true }`.
    - `PATCH /api/guias/itens/[id]` `{ executedAt }` → 200 `{ ok: true }`.
    - `POST /api/guias/itens/[id]/atualizar` → recopia código/nome (do procedimento da tabela do tratamento), dentes e valor do tratamento → 200 `{ ok: true }`; tratamento apagado ou fora da tabela → 422 `'Tratamento fora da tabela do convênio'`.
- [ ] **Step 1: Testes:** `erroDoBanco` para cada código; `parseEnvio({ protocol: ' ' })` → `'Informe o protocolo'`; repo com `fakeAdmin` e `rpc` falso (padrão de `tests/agente/agendamento/repo.test.ts`): `criarGuia` chama `create_insurance_guide` com `p_items` dos itens; `tratamentosParaGuia` filtra por `clinic_id`; rotas (chamando o `POST`/`PATCH` exportado, com `vi.mock('@/lib/auth/currentClinic')` devolvendo `{ clinicId, userId }` e `vi.mock('@/lib/supabase/admin')` devolvendo o `fakeAdmin` com `rpc`; padrão de mocks em `tests/messaging/cronRoute.test.ts`): id não UUID → 422; criação com tratamento em guia ativa → 422 `'Tratamento já está em outra guia'`; RPC devolvendo `23505` → 409; **`atualizar item em lote → 409`**; resposta com `GUIA_EM_LOTE` → 409.
- [ ] **Step 2–4:** rodar (FAIL), implementar, rodar (PASS) + `npx tsc --noEmit -p .`.
- [ ] **Step 5: Commit** `feat(convenios): rotas de guias`.

### Task 5: Rotas de lotes e pendências

**Files:**
- Create: `src/app/api/convenios/lotes/route.ts` (GET), `src/app/api/convenios/lotes/[id]/itens/[itemId]/route.ts` (PATCH), `src/app/api/convenios/lotes/[id]/enviar/route.ts` (POST), `src/app/api/convenios/pendencias/route.ts` (GET)
- Modify: `src/lib/convenios/repo.ts`
- Test: `tests/convenios/rotas-lotes.test.ts`, `tests/convenios/repo.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `repo.ts` ganha: `operadoras(clinicId): Promise<{ id; name; closing_day; submission_days; active }[]>`; `itensSemLote(clinicId): Promise<{ id; guide_id; plan_id; active; authorization; batch_id; executed_at; defer_until; treatment: { status; completed_at } | null }[]>`; `lotes(clinicId, planId?): Promise<InsuranceBatch[]>`; `criarLotes(clinicId, planId, periodos[]): Promise<void>` (upsert ignorando duplicados); `atribuir(clinicId, batchId, itemIds): Promise<number>` (RPC `assign_batch_items`); `removerDoLote(clinicId, batchId, itemId, deferUntil)`; `enviarLote(clinicId, batchId, protocol, sentAt)`; `marcarDigitado(clinicId, batchId, itemId, typed)` (só lote `aberto`: lê o lote e atualiza o item com `batch_id = batchId`; lote enviado → 409 `'Lote já enviado'`); `lotesComItens(clinicId)` (lotes abertos + enviados dos últimos 6 meses com itens, guia, paciente, carteirinha); `dadosPendencias(clinicId)` (entrada de `montarPendencias`).
  - `GET /api/convenios/lotes`: para cada operadora ativa com `closing_day`, `planejarLotes` → `criarLotes` → `atribuir` por lote aberto; devolve `{ lotes: [{ id, plan: { id, name }, period_start, period_end, due_date, status, protocol, sent_at, total, itens: [{ id, patient_id, patient_name, insurance_card, guide_number, password, code, name, teeth, executed_at, value, typed, atrasado }] }] }` (ordenados por `due_date`; `atrasado` via `atrasado(execucao, period_start)`). `LOTE_ENVIADO` em `atribuir` (corrida) é ignorado e os itens ficam para a próxima chamada.
  - `PATCH /api/convenios/lotes/[id]/itens/[itemId]` `{ typed }` ou `{ remover: true }` (adia com `adiarAte(period_end, closing_day)`) → 200 `{ ok: true }`.
  - `POST /api/convenios/lotes/[id]/enviar` `{ protocol, sentAt }` → 200 `{ ok: true }`.
  - `GET /api/convenios/pendencias` → `{ itens: Pendencia[], contador }` (hoje em `America/Sao_Paulo`).
- [ ] **Step 1: Testes:** montagem cria lote do período e atribui itens prontos (repo falso injetado ou `fakeAdmin` + `rpc`); operadora sem `closing_day` não monta; item `pendente` não é atribuído; **`enviar duas vezes devolve 409 na segunda`** (RPC `LOTE_ENVIADO`); **`atribuir em lote enviado não grava`** (RPC `LOTE_ENVIADO` → GET responde 200 sem o item no lote); remover chama `remove_batch_item` com `defer_until` do período seguinte; digitado em lote enviado → 409; pendências devolve contador.
- [ ] **Step 2–4:** rodar (FAIL), implementar, rodar (PASS) + `npx tsc --noEmit -p .`.
- [ ] **Step 5: Commit** `feat(convenios): rotas de lotes e pendências`.

### Task 6: Telas de cadastro (operadora, tabela, carteirinha)

**Files:**
- Modify: `src/app/(dashboard)/configuracoes/convenios/page.tsx`, `src/components/paciente/ModalEditarPaciente.tsx`
- Create: `src/components/convenios/PainelOperadora.tsx`, `src/components/convenios/TabelaOperadora.tsx`

**Interfaces:**
- Consumes: Task 1 (`validarOperadora`, `validarItemTabela`, `validarCarteirinha`, tipos).
- Produces: UI (spec §Telas, 1º e 2º itens).
  - Convênios: cada operadora vira linha clicável que abre `PainelOperadora` (registro ANS, código do prestador, dia de fechamento, prazo, ativa; salvar com `validarOperadora` e `update` pelo cliente Supabase) com `TabelaOperadora` abaixo: busca na `tuss_procedures` (`ilike` em `name` ou prefixo de `code`, até 20 resultados, mínimo 2 caracteres), adicionar com valor e "exige autorização", editar valor/flag inline, desativar/reativar, "Código fora da lista" (código + nome à mão), código repetido → `'Esse código já está na tabela'` (`23505`). Excluir operadora com guias → mensagem do ruling.
  - Paciente: campos "Carteirinha" e "Validade" abaixo do convênio, validados com `validarCarteirinha`.
- [ ] **Step 1:** implementar; `npx tsc --noEmit -p .` e `npx eslint` nos arquivos tocados sem erros.
- [ ] **Step 2:** conferir no navegador (`localhost:3001/configuracoes/convenios`) que a busca TUSS traz `81000065 Consulta odontológica inicial` (depois de rodar os dois SQL) — se o banco local não tiver a migração, registrar no relatório e seguir.
- [ ] **Step 3: Commit** `feat(convenios): telas de operadora, tabela e carteirinha`.

### Task 7: Tratamentos e guias do paciente

**Files:**
- Modify: `src/components/paciente/TabTratamentos.tsx`, `src/app/(dashboard)/pacientes/[id]/page.tsx` (ler `?aba=` para abrir a aba; usar `useSearchParams` dentro de `Suspense`)
- Create: `src/components/paciente/SecaoGuias.tsx`, `src/components/convenios/ModalCriarGuia.tsx`, `src/components/convenios/ModalRespostaGuia.tsx`
- Test: nenhum novo (regras já testadas); `tsc` e `eslint`.

**Interfaces:**
- Consumes: Tasks 1–4 (rotas de guias, `divergencias`, `situacaoCarteirinha`).
- Produces: UI (spec §Telas, 3º e 4º itens).
  - Modais de novo/editar tratamento: com convênio escolhido, campo "Procedimento" vira busca na `insurance_plan_procedures` ativa da operadora (código + nome); ao escolher, grava `procedure = name`, `insurance_procedure_id` e `value` (editável). Sem convênio, campo de texto como hoje. Trocar o convênio limpa `insurance_procedure_id`.
  - Cada tratamento de convênio mostra selo: `Fora da tabela` | `Sem guia` | `Aguardando autorização` | `Autorizado` | `Negado` | `Em lote` (a partir do item ativo ou do último item negado).
  - `SecaoGuias` no fim da aba Tratamentos: guias do paciente (cliente Supabase, RLS) com itens, status, número/senha/validade; botões "Criar guia" (`ModalCriarGuia`: operadora do paciente, executante, checkboxes dos tratamentos elegíveis; aviso `Carteirinha vazia` / `Carteirinha vencida` com `situacaoCarteirinha`), "Registrar resposta" (`ModalRespostaGuia`: número, senha, validade, autorizado/negado + motivo por item que exige), "Cancelar guia" (confirmação), selo `Diferente do tratamento` com botão "Atualizar item" (oculto se em lote). Erros das rotas exibidos com o texto `error`.
- [ ] **Step 1:** implementar; `npx tsc --noEmit -p .` e `npx eslint` nos arquivos tocados.
- [ ] **Step 2: Commit** `feat(convenios): procedimento da tabela e guias do paciente`.

### Task 8: Tela Convênios, menu e README

**Files:**
- Create: `src/app/(dashboard)/convenios/page.tsx`, `src/components/convenios/AbaPendencias.tsx`, `src/components/convenios/AbaLotes.tsx`
- Modify: `src/components/layout/Navbar.tsx`, `README.md`

**Interfaces:**
- Consumes: Task 5 (rotas), Task 3 (`Pendencia`).
- Produces:
  - `/convenios` com abas `Pendências` e `Lotes` (`?aba=lotes&lote=<id>` abre e rola até o lote; `useSearchParams` dentro de `Suspense`).
  - Lote (spec §Telas último item): cabeçalho com operadora, `mm/aaaa`, período, `Prazo: dd/mm (faltam N dias | vence hoje | vencido há N dias)`, status; itens agrupados por paciente e guia; selo `Atrasado`; caixinha "digitado" (PATCH otimista, desfaz em erro); "Tirar do lote"; total; **Imprimir** (`window.print()` com CSS `@media print` que esconde menu/botões e imprime só o lote aberto); **Marcar como enviado** (modal protocolo + data, padrão hoje). Lote enviado: travado, mostra protocolo e data.
  - Navbar: link `{ label: 'Convênios', href: '/convenios', icon: ShieldCheck }` depois de `Financeiro`; contador vindo de `GET /api/convenios/pendencias` (`contador`), atualizado a cada 30 s com a página visível e no evento `convenios:changed` (disparado pelas telas após criar/responder/cancelar guia, enviar lote ou mexer em item).
  - README: seção **"Convênios"** — rodar `supabase/2026-11-07-convenios-guias.sql` e depois `supabase/2026-11-07-tuss-odontologia.sql`; cadastrar operadora (registro ANS, código do prestador, fechamento, prazo) e tabela; carteirinha; tratamento com procedimento da tabela; criar guia e registrar autorização; lote do mês, digitar no portal, marcar enviado; o que vem na 7b.
- [ ] **Step 1:** implementar; `npx tsc --noEmit -p .`, `npx eslint` nos arquivos tocados, `npx vitest run` (tudo verde).
- [ ] **Step 2: Commit** `feat(convenios): tela de pendências e lotes, menu e README`.
