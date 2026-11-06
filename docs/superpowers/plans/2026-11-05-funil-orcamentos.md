# Funil de orçamentos e assinatura eletrônica: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A clínica envia o orçamento pelo WhatsApp, o paciente escolhe os itens e assina por um link público, lembretes e a lista "Para ligar" recuperam os parados, e a página "Orçamentos" mostra o funil por período e dentista.

**Architecture:** Regras puras em `src/lib/orcamentos/*` (etapas, funil, para ligar, assinatura, comprovante). Decisões que mudam estado (assinar, aprovar pela recepção, recusar, perder) passam por funções SQL transacionais chamadas pelo servidor com service role. Gatilhos no banco travam orçamento aprovado e desativam o link quando um orçamento enviado é editado. Lembretes entram no planejador de mensagens existente (`src/lib/messaging/schedule.ts`).

**Tech Stack:** Next.js 16 (route handlers, server components), React 19, Supabase (Postgres, RLS, funções SQL, gatilhos), Vitest, `pdf-lib`, `node:crypto`.

**Spec:** `docs/superpowers/specs/2026-11-05-funil-orcamentos-design.md`

## Global Constraints

- Next.js 16: antes de escrever route handlers ou páginas, ler `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` e `page.md` (`params` é `Promise`; usar `RouteContext<'/api/...'>` e `PageProps<'/orcamento/[token]'>`; rodar `npx next typegen` se o tipo não existir).
- Rotas autenticadas: `getCurrentClinic()` (`src/lib/auth/currentClinic.ts`); 401 `{ error: 'Não autorizado.' }`; erro inesperado 500 `{ error: 'Erro interno. Tente novamente.' }` com `console.error('[orcamentos/<rota>] ...')` (padrão de `src/app/api/payments/[id]/send-link/route.ts`). Escritas de estado usam `createAdminClient()` e sempre filtram por `clinic_id`.
- Rotas públicas (`/orcamento/*`, `/api/public/*`): só `createAdminClient()`; nunca devolvem CPF, telefone ou e-mail do paciente; respostas com `Cache-Control: no-store` e `X-Robots-Tag: noindex`.
- Valores em centavos inteiros na lógica (`toCents`/`fromCents` de `src/lib/payments/money.ts`).
- CPF: `normalizeCpf`/`isValidCpf` de `src/lib/payments/cpf.ts`.
- Código do link: `randomBytes(32).toString('base64url')` (43 caracteres). URL: `${process.env.APP_URL}/orcamento/${token}`.
- Valores fixos da spec: validade padrão 30 dias (1 a 180); lembretes `offset_days` padrão `[3, 7]`; "Para ligar" sem lembretes = 7 dias; visualizado sem decisão = 2 dias; bloqueio após 5 CPFs errados por 1 hora; comprovante público por 30 dias após a assinatura; `user_agent` e `ip` cortados em 300 caracteres.
- Motivos de perda (código → rótulo): `preco` Achou caro, `pensar` Vai pensar, `outro_lugar` Fez em outro lugar, `tempo` Sem tempo, `medo` Medo ou ansiedade, `sem_resposta` Sem resposta, `outro` Outro.
- Mensagens de erro: exatamente as da spec §9.
- Migração `supabase/2026-11-05-funil-orcamentos.sql` re-executável, espelhada em `supabase/schema.sql`.
- Texto em português do Brasil, estilo das telas atuais (`#3B82F6`, `#111827`, `#6B7280`, `#E5E7EB`, cards `rounded-xl border`).

## Review Focus

1. **Pré-visualização do WhatsApp abrindo o link:** o WhatsApp busca a página para montar a prévia; isso não pode marcar "visualizado". A visualização é registrada por um POST feito pelo navegador depois de carregar. → Task 7 (`page GET does not record view`).
2. **Duas abas assinando ao mesmo tempo** ou assinatura depois de a recepção editar: só a primeira vale; a segunda recebe "Este orçamento já foi respondido." → Task 4 (`second approval is rejected`) e Task 1 (função SQL com `FOR UPDATE`).
3. **Edição de orçamento enviado pela tela antiga** (gravação direta no Supabase): o link deixa de funcionar e o orçamento volta a rascunho, sem depender da tela. → Task 1 (teste de migração do gatilho) e Task 9.
4. **Fuso horário nas datas** (envio às 22h de um dia, validade, lembretes no dia 3): dias contados no fuso da clínica (`todayYmd(now, cfg.timezone)`), não em UTC. → Task 5 (`reminder day counted in clinic timezone`) e Task 2 (`needsCall uses clinic day`).
5. **Lembrete já na fila quando o paciente assina ou o link é trocado:** a mensagem é cancelada antes de sair. → Task 5 (`stale budget reminder is cancelled`).

---

## File Structure

```
supabase/2026-11-05-funil-orcamentos.sql        (novo) migração
supabase/schema.sql                             (mod) espelho
src/types/index.ts                              (mod) Budget, BudgetItem, BudgetEvent, BudgetSignature, LostReason
src/lib/orcamentos/etapas.ts                    (novo) motivos, rótulos, transições (puro)
src/lib/orcamentos/paraLigar.ts                 (novo) needsCall (puro)
src/lib/orcamentos/funil.ts                     (novo) buildFunnel (puro)
src/lib/orcamentos/assinatura.ts                (novo) snapshot, JSON canônico, hash, CPF (puro)
src/lib/orcamentos/comprovante.ts               (novo) PDF
src/lib/orcamentos/links.ts                     (novo) criar, buscar, desativar link; tentativas
src/lib/orcamentos/aprovacao.ts                 (novo) approveBudget, rejectBudget, expireBudgets
src/lib/orcamentos/envio.ts                     (novo) sendBudget (link + WhatsApp)
src/lib/orcamentos/repo.ts                      (novo) consultas Supabase
src/lib/messaging/{types,templates,schedule,cycleData,cycle,manual}.ts (mod) budget e budget_reminder
src/app/api/cron/messages/route.ts              (mod) vence orçamentos
src/app/api/orcamentos/...                      (novo) rotas autenticadas
src/app/api/public/orcamento/[token]/...        (novo) rotas públicas
src/app/orcamento/[token]/page.tsx              (novo) página do paciente (+ componente cliente)
src/proxy.ts                                    (mod) caminhos públicos
src/app/(dashboard)/orcamentos/page.tsx         (novo) funil
src/components/orcamentos/*                     (novo) indicadores, abas, modal de contato, modal de decisão
src/components/layout/Navbar.tsx                (mod) item Orçamentos + contador
src/components/paciente/TabOrcamentos.tsx       (mod) etapas, botões, histórico, dentista, validade
src/components/mensagens/TabAutomaticas.tsx     (mod) modelos budget e budget_reminder
src/app/(dashboard)/configuracoes/clinica/...   (mod) validade padrão
README.md                                       (mod) seção do funil
```

---

### Task 1: Banco de dados e tipos

**Files:**
- Create: `supabase/2026-11-05-funil-orcamentos.sql`
- Modify: `supabase/schema.sql`, `src/types/index.ts`
- Test: `tests/supabase/migration.test.ts` (acrescentar bloco `funil-orcamentos`)

**Interfaces:**
- Produces: tabelas e colunas da spec §6; funções SQL `approve_budget`, `reject_budget`; tipos TS `BudgetStatus = 'draft'|'sent'|'approved'|'rejected'|'expired'|'completed'`, `LostReason`, `Budget`, `BudgetItem` (com `approved: boolean | null`), `BudgetEvent`, `BudgetSignature`.

- [ ] **Step 1: Testes da migração** (lendo o arquivo SQL como texto, padrão dos testes existentes): contém `budget_validity_days`, as 10 colunas novas de `budgets`, o CHECK de status com os 6 valores, o CHECK de `lost_reason` com os 7 códigos, `budget_links` sem nenhum `CREATE POLICY ... ON budget_links`, índice único parcial `WHERE revoked_at IS NULL`, `budget_signatures`, `budget_events` com policy de insert restrita a `type = 'contact'` e `created_by = auth.uid()`, tipos de mensagem `budget` e `budget_reminder` nos CHECKs de `messages` e `message_settings`, `messages.budget_id`, `CREATE OR REPLACE FUNCTION public.approve_budget`, `public.reject_budget`, `REVOKE ALL ON FUNCTION public.approve_budget` de `PUBLIC, anon, authenticated`, os dois gatilhos, e o preenchimento dos dados antigos.
- [ ] **Step 2: Rodar** `npx vitest run tests/supabase/migration.test.ts` → FAIL.
- [ ] **Step 3: Escrever a migração** conforme spec §6, mais:
  - **Modo sistema:** funções SQL fazem `PERFORM set_config('app.budget_system', 'on', true)`; os gatilhos ignoram tudo quando `current_setting('app.budget_system', true) = 'on'`.
  - **Gatilho de edição** (`budgets` BEFORE UPDATE e `budget_items` BEFORE INSERT/UPDATE/DELETE): se o orçamento está `sent` e mudou `procedure`, `tooth`, `quantity`, `unit_price`, o conjunto de itens, `total` ou `valid_until` → `status = 'draft'`, `UPDATE budget_links SET revoked_at = now()` do orçamento, insere evento `edited`.
  - **Gatilho de trava:** se está `approved` ou `completed`, recusa mudança nesses campos e em `approved`/`approved_total` com `RAISE EXCEPTION 'Orçamento aprovado não pode ser alterado. Reabra-o ou crie um novo.'`. Fora do modo sistema, também recusa mudar `status` para `sent`, `approved` ou `expired` (só o servidor faz isso); `approved → completed`, `completed → approved`, `rejected|expired → draft` e `draft → rejected` continuam livres.
  - **`approve_budget(p_budget_id uuid, p_link_id uuid, p_item_ids uuid[], p_approved_total numeric, p_signature jsonb, p_actor uuid)` RETURNS text:** `SELECT ... FOR UPDATE` no orçamento; se `p_link_id` não é nulo, exige status `sent` e link ativo do mesmo orçamento; se é nulo (recepção), aceita `sent` ou `draft`; senão devolve `'already_decided'`. Marca `approved = (id = ANY(p_item_ids))` nos itens, grava `status='approved'`, `approved_total`, `decided_at=now()`, `followup_at=NULL`, `lost_reason=NULL`; insere em `budget_signatures` os campos de `p_signature`; desativa links; insere evento `approved` (`created_by = p_actor`). Devolve `'ok'`.
  - **`reject_budget(p_budget_id uuid, p_link_id uuid, p_reason text, p_note text, p_actor uuid, p_status text)` RETURNS text:** mesma checagem; `p_status` é `'rejected'` ou `'expired'`; grava `lost_reason`, `decided_at`; desativa links; evento `rejected` ou `expired`.
- [ ] **Step 4: Espelhar em `schema.sql`** e atualizar `src/types/index.ts`.
- [ ] **Step 5: Rodar** os testes da migração e `npx tsc --noEmit` → PASS.
- [ ] **Step 6: Commit** `feat(orcamentos): migração do funil e assinatura`.

### Task 2: Etapas, para ligar e funil (puro)

**Files:**
- Create: `src/lib/orcamentos/etapas.ts`, `paraLigar.ts`, `funil.ts`
- Test: `tests/orcamentos/etapas.test.ts`, `paraLigar.test.ts`, `funil.test.ts`

**Interfaces:**
- Produces:
  - `LOST_REASONS: { code: LostReason; label: string }[]`, `lostReasonLabel(c)`, `STAGE_LABEL: Record<BudgetStatus, string>` (`draft` Rascunho, `sent` Enviado, `approved` Aprovado, `rejected` Perdido: recusado, `expired` Perdido: vencido, `completed` Concluído).
  - `canSend(b: { status; total: number; itemCount: number }): { ok: true } | { ok: false; error: string }` (erro "Adicione ao menos um item com valor antes de enviar"; status precisa ser `draft` ou `sent`).
  - `canReopen(status)`, `canDecideByReception(status)` (`draft`|`sent`).
  - `needsCall(b: { status; sent_at: string|null; viewed_at: string|null; followup_at: string|null; link_created_at: string|null }, now: Date, tz: string, reminderDays: number[] | null): boolean` — regra da spec §5; dias pelo calendário do fuso (`todayYmd` de `src/lib/messaging/time.ts`); base dos lembretes = `link_created_at ?? sent_at`; `reminderDays` nulo ou vazio = 7 dias.
  - `buildFunnel(rows: FunnelRow[], filter: { from: string; to: string; professionalId?: string | null }): Funnel` com `FunnelRow = { id; status; sent_at; decided_at; total; approved_total; professional_id; professional_name; lost_reason }` e `Funnel = { presented: { count; cents }; approved: { count; cents }; rateCents: number|null; rateCount: number|null; avgDaysToApprove: number|null; byProfessional: { id: string|null; name: string; presented; approved; rateCents }[]; lostReasons: { code; label; count }[] }`. Período inclusivo por `sent_at` (data do fuso `America/Sao_Paulo`); taxa = aprovado/apresentado (nula sem apresentados); `approved` conta `approved` e `completed`; perdidos = `rejected` e `expired`; `id: null` vira "Sem dentista".

- [ ] **Step 1: Testes**:
  - `etapas`: `canSend` recusa total 0 e sem itens com a mensagem exata; recusa `approved`; aceita `draft` e `sent`; `canReopen` só `rejected`/`expired`.
  - `paraLigar`: lembretes `[3,7]`, link criado há 7 dias → true, há 6 → false; sem lembretes, 7 dias → true; visualizado há 2 dias → true; `followup_at` amanhã → false, hoje → true; status `approved` → false; `needsCall uses clinic day` (envio 2026-11-01T23:30-03:00 = dia 1 em São Paulo; em 2026-11-08T01:00Z ainda é dia 7 no fuso → true com `[3,7]`).
  - `funil`: período por `sent_at`; parcial soma `approved_total`; taxa em R$ e em quantidade; `completed` conta como aprovado; "Sem dentista"; tempo médio (2 aprovações em 2 e 4 dias → 3); motivos ordenados por contagem; filtro por dentista; sem apresentados → taxas nulas.
- [ ] **Step 2: Rodar** `npx vitest run tests/orcamentos` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `feat(orcamentos): etapas, para ligar e funil`.

### Task 3: Assinatura e comprovante

**Files:**
- Create: `src/lib/orcamentos/assinatura.ts`, `src/lib/orcamentos/comprovante.ts`
- Test: `tests/orcamentos/assinatura.test.ts`, `tests/orcamentos/comprovante.test.ts`

**Interfaces:**
- Produces:
  - `type Snapshot = { clinica: string; paciente: string; dentista: string|null; orcamento: string; data: string; validade: string|null; itens_aprovados: { procedimento; dente: string|null; quantidade; preco_unitario: string; subtotal: string }[]; itens_nao_aprovados: { procedimento }[]; total_aprovado: string; assinante: { nome; cpf }; assinado_em: string }` (valores monetários como texto `"1234.56"`, CPF só dígitos, datas ISO).
  - `buildSnapshot(args: { clinicName; patientName; professionalName: string|null; budget: { id; created_at; valid_until }; items: { id; procedure; tooth; quantity; unit_price }[]; approvedIds: string[]; signer: { name; cpf }; signedAt: Date }): Snapshot`; `orcamento` = 8 primeiros caracteres do id em maiúsculas.
  - `canonicalJson(v: unknown): string` (chaves ordenadas recursivamente, sem espaços); `hashSnapshot(s: Snapshot): string` (`createHash('sha256')`, hex).
  - `checkSignerCpf(typed: string, patientCpf: string|null, payerCpf: string|null): { ok: true; cpf: string } | { ok: false; error: 'CPF inválido' | 'O CPF não confere com o cadastro. Confira ou fale com a clínica.' }` — CPFs cadastrados inválidos contam como ausentes.
  - `interface SignatureProvider { id: 'app'; sign(input): Promise<{ providerRef: string|null }> }` e `appSignatureProvider` (devolve `{ providerRef: null }`).
  - `buildReceiptPdf(s: Snapshot, meta: { hash; ip: string|null; userAgent: string|null; provider: 'app'|'reception' }): Promise<Uint8Array>` — texto WinAnsi-seguro (reaproveitar o saneamento de `src/lib/livro-caixa/exportacao.ts` extraindo-o para `src/lib/pdf/texto.ts` se ainda não for exportado); para `app` a frase "Assinado eletronicamente (Lei 14.063/2020, assinatura simples)"; para `reception` "Aprovado pela recepção, sem assinatura eletrônica do paciente".

- [ ] **Step 1: Testes:** mesma entrada → mesmo hash; ordem de chaves diferente → mesmo `canonicalJson`; mudar um preço → hash diferente; CPF formatado `'529.982.247-25'` confere com cadastrado `'52998224725'`; confere com o responsável; sem cadastro aceita qualquer válido; `'111.111.111-11'` → "CPF inválido"; cadastro inválido + digitado válido → aceita; PDF começa com `%PDF` e não lança com nome `'José Ação – “teste”'`.
- [ ] **Step 2–4:** rodar (FAIL), implementar, rodar (PASS).
- [ ] **Step 5: Commit** `feat(orcamentos): snapshot, hash e comprovante`.

### Task 4: Links, aprovação, envio e repositório

**Files:**
- Create: `src/lib/orcamentos/links.ts`, `aprovacao.ts`, `envio.ts`, `repo.ts`
- Modify: `src/lib/messaging/manual.ts` (aceitar `kind: 'manual' | 'budget'` e `budgetId` opcional; grava `type` e `budget_id` na linha), `src/lib/messaging/manualDeps.ts` se necessário
- Test: `tests/orcamentos/links.test.ts`, `aprovacao.test.ts`, `envio.test.ts`; ajustar `tests/messaging/manual.test.ts`

**Interfaces:**
- Consumes: Task 1 (funções SQL), Task 2 (`canSend`), Task 3.
- Produces (todas com deps injetadas; `repo.ts` monta as deps reais com `createAdminClient()`):
  - `newToken(): string`; `linkUrl(token): string`.
  - `resolveLink(token, deps): Promise<LinkView | null>` — `LinkView = { linkId; budgetId; clinicId; status; active: boolean; lockedUntil: Date|null; signedAt: Date|null }`; token com formato inválido → `null` sem consultar.
  - `registerFailedAttempt(linkId, now, deps)`: incrementa; ao chegar a 5 grava `locked_until = now + 1h` e zera o contador; `isLocked(view, now)`.
  - `approveBudget(input: { budgetId; clinicId; linkId: string|null; itemIds: string[]; signer: { name; cpf } | null; actorId: string|null; ip: string|null; userAgent: string|null; now: Date }, deps): Promise<{ ok: true } | { ok: false; status: number; error: string }>` — valida pelo menos um item ("Selecione ao menos um item"), itens pertencem ao orçamento, monta snapshot e hash, calcula `approved_total` em centavos, chama `approve_budget`; `'already_decided'` → 409 "Este orçamento já foi respondido.". `signer` nulo = recepção (`provider = 'reception'`, assinante = nome do usuário, CPF vazio).
  - `rejectBudget(input: { budgetId; clinicId; linkId: string|null; reason: LostReason|null; note: string|null; actorId: string|null; status: 'rejected'|'expired' }, deps)` — recepção exige motivo ("Escolha o motivo"); paciente sem motivo grava `outro`.
  - `expireBudgets(now: Date, deps): Promise<number>` — `sent` com `valid_until` < hoje (fuso `America/Sao_Paulo`) → `reject_budget(..., 'sem_resposta', ..., 'expired')`.
  - `sendBudget(input: { budgetId; clinicId; actorId; resend: boolean }, deps): Promise<{ status: number; body: { link: string; sent: boolean; warning?: string } | { error: string } }>` — `canSend`; envio novo cria link (desativa o anterior), grava `sent_at` se vazio, `valid_until` = hoje + `budget_validity_days` se vazio, `status = 'sent'` (via função SQL ou update em modo sistema), evento `sent`; reenvio reaproveita o link ativo, evento `resent`. Depois tenta o WhatsApp com o modelo `budget` da clínica (padrão da Task 5) via `sendManual({ kind: 'budget', budgetId })`. Falha de WhatsApp não desfaz o envio: devolve 200 com `sent: false` e `warning` — 409 "WhatsApp desconectado. O link foi criado: copie e envie por outro meio."; sem telefone "Paciente sem telefone. Copie o link e envie por outro meio."; outros erros do `sendManual` repassam o texto dele.

- [ ] **Step 1: Testes:** token com 43 caracteres `[A-Za-z0-9_-]`; formato inválido não consulta; 5ª tentativa bloqueia por 1 hora e 4ª não; `approveBudget` sem itens → 422; item de outro orçamento → 422; `already_decided` → 409 com a mensagem exata (`second approval is rejected`); total aprovado de 2 itens (2 × R$ 150,00 + R$ 89,90 = R$ 389,90); recepção grava `provider: 'reception'`; `rejectBudget` da recepção sem motivo → 422; `expireBudgets` só pega `sent` vencidos; `sendBudget` com WhatsApp desconectado → 200, `sent: false`, aviso exato e link presente; reenvio não cria link novo; total zero → 422 com a mensagem da spec.
- [ ] **Step 2–4:** rodar (FAIL), implementar, rodar (PASS) incluindo `tests/messaging`.
- [ ] **Step 5: Commit** `feat(orcamentos): links, aprovação e envio`.

### Task 5: Lembretes e vencimento na rotina de mensagens

**Files:**
- Modify: `src/lib/messaging/types.ts`, `templates.ts`, `schedule.ts`, `cycleData.ts`, `cycle.ts`, `src/app/api/cron/messages/route.ts`, `src/components/mensagens/TabAutomaticas.tsx`
- Test: `tests/messaging/schedule.test.ts`, `templates.test.ts`, `cycle.test.ts`

**Interfaces:**
- Consumes: Task 4 (`expireBudgets`, `linkUrl`).
- Produces: `MessageType` ganha `'budget' | 'budget_reminder'`; `DEFAULT_TEMPLATES.budget` e `.budget_reminder` com os textos exatos da spec §6; `buildContext` aceita `budget?: { total: number; valid_until: string|null }` (preenche `valor` e `vencimento`); `PlanInput.budgets: BudgetReminderRow[]` com `{ id; patient_id; total; valid_until; link_id; token; link_created_at }` (só `sent` com link ativo); `dedupeKey('budget_reminder', { budgetId, linkId, offsetDays })` = `budget_reminder:<budgetId>:<linkId>:<dia>`; `staleReason` devolve `'decided'` para `budget_reminder` cujo orçamento não está `sent` ou cujo link da chave não é o ativo.

- [ ] **Step 1: Testes:** lembrete no dia 3 e 7 depois da criação do link, nenhum no 4; `reminder day counted in clinic timezone`; opt-out e sem telefone não planejam; texto renderizado com `{valor}`, `{vencimento}` e `{link}`; `stale budget reminder is cancelled` (orçamento aprovado e link trocado); o tipo `budget` (envio manual) nunca é planejado pela rotina; a rotina chama `expireBudgets` uma vez por execução.
- [ ] **Step 2–4:** rodar (FAIL), implementar, rodar (PASS). `TabAutomaticas`: card "Lembrete de orçamento" com dias (como `payment_due`) e card "Envio de orçamento" só com o texto (sem liga/desliga).
- [ ] **Step 5: Commit** `feat(orcamentos): lembretes e vencimento automáticos`.

### Task 6: Rotas autenticadas

**Files:**
- Create: `src/app/api/orcamentos/[id]/enviar/route.ts` (POST `{ resend?: boolean }`), `[id]/link/route.ts` (GET), `[id]/decisao/route.ts` (POST `{ action: 'approve', itemIds } | { action: 'lose', reason, note? } | { action: 'reopen' }`), `[id]/comprovante/route.ts` (GET PDF), `src/app/api/orcamentos/funil/route.ts` (GET `?de=YYYY-MM-DD&ate=YYYY-MM-DD&dentista=<id|none>`)
- Modify: `src/lib/orcamentos/repo.ts`
- Test: `tests/orcamentos/rotas.test.ts` (lógica de validação extraída em funções puras, como nas rotas do livro-caixa)

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces: `funil` devolve `{ funnel: Funnel, tabs: { enviados: Row[]; paraLigar: Row[]; aprovados: Row[]; perdidos: Row[] }, professionals: { id; name }[] }` com `Row = { id; patient: { id; name; phone }; professional_name; total; approved_total; charged: number; sent_at; viewed_at; valid_until; decided_at; lost_reason; followup_at; last_events: BudgetEvent[] (até 3); approval_seen: boolean }`. "Enviados" e "Para ligar" não dependem do período (mostram tudo que está `sent`); "Aprovados" e "Perdidos" filtram por `decided_at` no período. `charged` = soma dos pagamentos do orçamento exceto `cancelled`/`refunded`.

- [ ] **Step 1: Testes:** datas inválidas → 422 "Período inválido"; `de` > `ate` → 422; ação desconhecida → 422; `lose` sem motivo → 422 "Escolha o motivo"; `reopen` de `approved` → 422.
- [ ] **Step 2–4:** rodar (FAIL), implementar, rodar (PASS); `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(orcamentos): rotas do funil e da recepção`.

### Task 7: Página pública do paciente

**Files:**
- Create: `src/app/orcamento/[token]/page.tsx` (server component), `src/components/orcamentos/AprovacaoPaciente.tsx` (cliente), `src/app/api/public/orcamento/[token]/route.ts` (GET dados), `.../assinar/route.ts` (POST `{ itemIds, name, cpf, agreed }`), `.../recusar/route.ts` (POST `{ reason?, note? }`), `.../visto/route.ts` (POST), `.../comprovante/route.ts` (GET)
- Modify: `src/proxy.ts`
- Test: `tests/orcamentos/publico.test.ts`

**Interfaces:**
- Consumes: Tasks 3–4.
- Produces: `publicView(token, now, deps): Promise<{ kind: 'unavailable' } | { kind: 'approved'; signedAt; canDownload: boolean } | { kind: 'open'; clinic: { name; logoUrl: string|null }; professional: string|null; number; createdAt; validUntil; items: { id; procedure; tooth; quantity; unitPrice }[] }>`; `recordView(token, deps)` grava `viewed_at` (se vazio), `view_count + 1`, evento `viewed` só na primeira vez por link.

- [ ] **Step 1: Testes:** link inexistente, desativado, de orçamento `rejected`/`expired` ou vencido → `unavailable`; aprovado há 29 dias → `approved` com download; há 31 → `canDownload: false`; `open` não contém CPF, telefone nem e-mail (verificar com `JSON.stringify`); `page GET does not record view` (`publicView` não chama `recordView`); assinatura com link bloqueado → 429 "Muitas tentativas. Tente de novo em 1 hora ou fale com a clínica."; CPF errado incrementa tentativas; `agreed` falso → 422; `ip` pega o primeiro valor de `x-forwarded-for` e corta em 300.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar.** `proxy.ts`: no início, `/orcamento/` e `/api/public/` seguem com `NextResponse.next({ request })`, sem consultar sessão (não redirecionam usuário logado). A página chama `POST .../visto` num `useEffect`. Depois de assinar, mostra "Aprovado ✓" e o botão do comprovante. Layout para celular, sem a Navbar.
- [ ] **Step 4: Rodar** → PASS; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(orcamentos): página de aprovação do paciente`.

### Task 8: Página "Orçamentos" (funil)

**Files:**
- Create: `src/app/(dashboard)/orcamentos/page.tsx`, `src/components/orcamentos/Indicadores.tsx`, `ListaOrcamentos.tsx`, `ModalContato.tsx`, `ModalDecisao.tsx` (escolha de itens para "aprovou por telefone" e motivo para "perdido")
- Modify: `src/components/layout/Navbar.tsx`
- Test: `tests/orcamentos/contato.test.ts` (função pura `contactOutcome(outcome, chosenDate, today)` → `{ followup_at; next: 'none'|'approve'|'lose' }`)

**Interfaces:**
- Consumes: rota `funil` (Task 6), rotas `decisao`, `enviar`, `link` e `comprovante`; `ModalNovaCobranca` com `budget = { id, total: approved_total - charged, label }`.

- [ ] **Step 1: Teste** `contactOutcome`: `nao_atendeu` → amanhã; `pensar` sem data → hoje + 3; `pensar` com data → a data; `aprovou` → `next: 'approve'`; `perdido` → `next: 'lose'`.
- [ ] **Step 2–3:** rodar (FAIL), implementar `contactOutcome` em `src/lib/orcamentos/contato.ts`, rodar (PASS).
- [ ] **Step 4: Telas** conforme spec §8: filtros (padrão mês atual), cartões, tabela por dentista, motivos, abas. Registrar contato grava `budget_events` (`type: 'contact'`) e `budgets.followup_at` pelo cliente Supabase do usuário; "aprovou" e "perdido" chamam `decisao`. Abrir a aba Aprovados grava `approval_seen_at = now()` nos aprovados sem marca. Navbar: item "Orçamentos" (`/orcamentos`, ícone `ClipboardList`) entre Pacientes e Financeiro, com bolinha de contagem de `budgets` `approved` com `approval_seen_at` nulo e `decided_at` nos últimos 30 dias.
- [ ] **Step 5:** `npx tsc --noEmit` e `npm run build` → sem erros.
- [ ] **Step 6: Commit** `feat(orcamentos): página do funil`.

### Task 9: Aba Orçamentos do paciente e validade padrão

**Files:**
- Modify: `src/components/paciente/TabOrcamentos.tsx`, `src/app/(dashboard)/configuracoes/clinica/` (campo "Validade padrão dos orçamentos (dias)")

**Interfaces:**
- Consumes: Tasks 2, 4, 6, 8 (`ModalDecisao`).

- [ ] **Step 1:** Remover os botões que gravavam `status` direto (`TabOrcamentos.tsx:96`); no lugar: etapa (`STAGE_LABEL`), dentista (select dos profissionais da clínica; novo orçamento vem com o profissional do usuário logado), validade, botões Enviar, Reenviar, Copiar link, Aprovou/Perdido (abre `ModalDecisao`), Reabrir, Comprovante, Gerar cobrança (com `approved_total - charged`, só se `> 0`), "Concluído" (`approved → completed`) e o histórico (`budget_events` em ordem cronológica). Itens de orçamento aprovado aparecem marcados como aprovados ou não aprovados; editar item de orçamento aprovado mostra o erro do banco.
- [ ] **Step 2:** Validade: inteiro de 1 a 180; fora disso "Informe de 1 a 180 dias".
- [ ] **Step 3:** `npx tsc --noEmit`, `npx vitest run`, `npm run build` → sem erros.
- [ ] **Step 4: Commit** `feat(orcamentos): aba do paciente e validade padrão`.

### Task 10: Documentação e teste com o usuário

**Files:** Modify: `README.md`

- [ ] **Step 1:** Seção "Funil de orçamentos": aplicar `supabase/2026-11-05-funil-orcamentos.sql`; `APP_URL` precisa ser um endereço que o celular do paciente alcance (em teste local, o túnel); o que o app faz e não faz; a frase sobre a assinatura simples (Lei 14.063/2020).
- [ ] **Step 2:** `npx vitest run`, `npx tsc --noEmit` → PASS.
- [ ] **Step 3: Commit** `docs: funil de orçamentos`.
- [ ] **Step 4: Teste com o usuário:** aplicar a migração; enviar um orçamento para o próprio WhatsApp; abrir no celular, desmarcar um item, assinar; baixar o comprovante; ver o funil e o contador; num segundo orçamento, registrar "vai pensar" e depois "perdido"; gerar cobrança do aprovado; rodar a rotina (`curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3001/api/cron/messages`) e conferir lembretes e vencimento.
