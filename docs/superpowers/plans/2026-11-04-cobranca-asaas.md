# Cobrança integrada (Asaas): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A clínica conecta a própria conta Asaas, gera cobranças (à vista, carnê, cartão parcelado ou registro manual) a partir do orçamento aprovado ou avulsas, envia o link pelo WhatsApp, recebe baixa automática por webhook, com conferência diária, e emite NFS-e.

**Architecture:** Lógica pura e testável em `src/lib/payments/*`, com dependências injetadas, no padrão de `src/lib/messaging/*`. O Asaas fica atrás da interface `PaymentProvider` (`src/lib/payments/provider.ts` + `asaas.ts`). Rotas Next.js em `src/app/api/payments/*`, `api/webhooks/asaas` e `api/cron/payments` ligam tudo ao Supabase (service role). A tabela `payments` é a fonte de verdade; o webhook e a conferência diária a mantêm em dia.

**Tech Stack:** Next.js 16 (route handlers), React 19, Supabase (Postgres + RLS + pg_cron/pg_net), Asaas API v3, Vitest, `@date-fns/tz`.

**Spec:** `docs/superpowers/specs/2026-11-04-cobranca-asaas-design.md`

## Global Constraints

- Next.js 16: antes de escrever route handlers, ler `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` (`params` é `Promise`; use `RouteContext<'/api/payments/[id]/...'>`).
- Rotas autenticadas usam `getCurrentClinic()` (`src/lib/auth/currentClinic.ts`): 401 sem sessão; recurso de outra clínica → 404. Banco no servidor via `createAdminClient()` (`src/lib/supabase/admin.ts`), sempre filtrando por `clinic_id`.
- `payment_connections`, `payment_customers` e `payment_events`: RLS ligada **sem policies** (só service role). `api_key` e `webhook_token` nunca saem do servidor nem aparecem em logs.
- Valores monetários na lógica em **centavos inteiros** (`number`); conversão para `NUMERIC(10,2)` só no repo.
- Datas de vencimento são `YYYY-MM-DD`. "Hoje" usa `todayYmd(now, tz)` de `src/lib/messaging/time.ts`, com o fuso de `clinics.messaging_config.timezone` (via `normalizeMessagingConfig`).
- Parcelas: de 1 a 12 nos dois tipos (carnê e cartão parcelado).
- Padrões: multa `2`%, juros `1`% ao mês, `nfse_auto=false`, `nfse_description='Serviços odontológicos: {descricao}'`, `nfse_service_code='4.12'`, `payment_due` com `{"offset_days":[3]}`, desligado.
- Asaas: base `https://api-sandbox.asaas.com/v3` (sandbox) ou `https://api.asaas.com/v3` (produção); header `access_token`; timeout de 15 s; clientes criados com `notificationDisabled: true`; webhook com header `asaas-access-token`, `sendType: 'SEQUENTIALLY'`.
- URL do webhook: `${ASAAS_WEBHOOK_BASE_URL ?? APP_URL}/api/webhooks/asaas`, sem barra dupla.
- Webhook sempre responde **200** depois de autenticar, mesmo se o processamento falhar (o evento fica `failed`). Só token ausente ou desconhecido → 401.
- Um evento atrasado nunca rebaixa um estado: `paid` e `refunded` só mudam por `PAYMENT_RECEIVED_IN_CASH_UNDONE` (paid → aberto) e `PAYMENT_REFUNDED` (→ refunded).
- Texto de interface em português do Brasil, com o estilo das telas existentes (`#3B82F6`, `#111827`, `#6B7280`, `#E5E7EB`, cards `rounded-xl border`).
- Mensagens ao paciente reusam o envio manual do WhatsApp, com opt-out e limite diário. **Desvio aprovado da spec §6.2.8:** o link é enviado na hora, como todo envio manual, que ignora a janela de horário, e não vai para a fila.

## Review Focus

1. **Asaas cria a cobrança, mas a gravação local falha ou o servidor cai no meio.** Não pode sobrar cobrança "fantasma" nem linha eterna em `creating`. → Task 7 (`leaves rows creating when linking fails after provider success`) e Task 10 (`completes creating group by externalReference`, `deletes creating rows older than 1h with no provider charge`).
2. **Webhook fora de ordem ou repetido:** `PAYMENT_OVERDUE` chegando depois de `PAYMENT_RECEIVED`, ou o mesmo `evt_` duas vezes. → Task 4 (`late OVERDUE does not downgrade paid`) e Task 9 (`duplicate provider_event_id is a no-op`).
3. **Vencimento em fim de mês e centavos que não dividem certo:** R$ 1.000,00 em 3x com 1º vencimento em 31/01. → Task 3 (`splits 100000 cents in 3 with remainder on last`, `keeps day 31 across short months`).
4. **Chave revogada no meio do uso:** a conferência e as ações não podem quebrar outras clínicas; a tela mostra "Reconecte o Asaas". → Task 10 (`marks invalid_key and continues with next clinic`) e Task 6 (`returns 409 asaas_invalid_key and flags connection`).
5. **Cartão parcelado:** todas as parcelas confirmadas de uma vez geram uma só nota (valor total), não N notas. → Task 9 (`card installment schedules one invoice for the group`).

---

## File Structure

```
scripts/asaas-sandbox-probe.mjs               roteiro da verificação inicial (grava fixtures)
docs/superpowers/plans/2026-11-04-asaas-sandbox-findings.md   resultados da verificação
supabase/2026-11-04-cobranca-asaas.sql        migração (pode rodar mais de uma vez)
supabase/schema.sql                           + o mesmo conteúdo
src/types/index.ts                            Payment/PaymentStatus estendidos; FiscalInvoice
src/lib/payments/
  money.ts           centavos ⇄ reais, formatação
  cpf.ts             validação/normalização de CPF
  installments.ts    divisão de valor e vencimentos
  status.ts          máquina de estados (evento/status do Asaas → patch do lançamento)
  provider.ts        interface PaymentProvider, tipos, PaymentProviderError
  asaas.ts           AsaasProvider
  index.ts           getProviderForClinic(), webhookUrl()
  repo.ts            acesso ao Supabase (service role)
  connection.ts      conectar/trocar/desconectar/atualizar configurações
  charges.ts         criar cobrança (orquestração)
  actions.ts         alterar vencimento, marcar pago, cancelar
  events.ts          processar evento do webhook
  invoices.ts        emitir/tentar de novo/cancelar NFS-e
  reconcile.ts       conferência diária
  notify.ts          enviar link de pagamento / nota pelo WhatsApp
src/lib/messaging/manualDeps.ts               createManualDeps(admin) extraído de api/messages/send
src/app/api/payments/connection/route.ts      GET/POST/PATCH/DELETE
src/app/api/payments/charges/route.ts         POST
src/app/api/payments/[id]/due-date/route.ts   POST
src/app/api/payments/[id]/receive/route.ts    POST
src/app/api/payments/[id]/cancel/route.ts     POST
src/app/api/payments/[id]/send-link/route.ts  POST
src/app/api/payments/[id]/invoice/route.ts    POST (emitir / tentar de novo)
src/app/api/invoices/[id]/cancel/route.ts     POST
src/app/api/invoices/[id]/send/route.ts       POST
src/app/api/webhooks/asaas/route.ts           POST
src/app/api/cron/payments/route.ts            POST
src/app/(dashboard)/configuracoes/pagamentos/page.tsx
src/components/pagamentos/ModalNovaCobranca.tsx
src/components/pagamentos/ListaPagamentos.tsx  linhas + menu de ações (paciente e Financeiro)
src/components/pagamentos/ModalEmitirNota.tsx
src/components/pagamentos/AsaasBanner.tsx
tests/payments/*.test.ts, tests/payments/fixtures/*.json
```

---

### Task 1: Verificação inicial no sandbox do Asaas

Pré-requisito: o usuário cria uma conta sandbox em https://sandbox.asaas.com e coloca a chave em `.env.local` como `ASAAS_SANDBOX_API_KEY`. Essa variável só é usada pelo roteiro, nunca pelo app. **Peça a chave ao usuário antes de começar.**

**Files:**
- Create: `scripts/asaas-sandbox-probe.mjs`, `tests/payments/fixtures/*.json`, `docs/superpowers/plans/2026-11-04-asaas-sandbox-findings.md`

**Interfaces:**
- Produces: fixtures usadas na Task 5. Nomes fixos: `customer-create.json`, `payment-single-undefined.json`, `installment-carne-create.json`, `installment-carne-payments.json`, `installment-card-create.json`, `installment-card-payments.json`, `payment-get-received.json`, `payment-get-deleted.json`, `receive-in-cash.json`, `update-due-date.json`, `webhook-create.json`, `fiscal-info.json`, `invoice-create.json`, `error-400.json`, `error-401.json`, `webhook-payment-received.json`, `webhook-payment-overdue.json`, `webhook-invoice-authorized.json`.

- [ ] **Step 1: Escrever o roteiro** `node --env-file=.env.local scripts/asaas-sandbox-probe.mjs <passo>`. Ele chama o sandbox, imprime as respostas e grava cada uma em `tests/payments/fixtures/<nome>.json`, trocando CPF, nome, e-mail e telefone por dados fictícios.
  Passos:
  - `customer`
  - `single` (UNDEFINED)
  - `carne` (installmentCount 3, totalValue 100.00, billingType UNDEFINED; se recusar, BOLETO e registra a recusa)
  - `card` (CREDIT_CARD, 3x)
  - `get`
  - `receive-in-cash`
  - `due-date`
  - `delete`, seguido de `get` da excluída
  - `cancel-installment`
  - `webhook` (cria e remove em seguida)
  - `fiscal-info`
  - `invoice`
  - `errors` (CPF inválido → 400; chave errada → 401)
- [ ] **Step 2: Rodar todos os passos**, guardar as fixtures e verificar que nenhuma tem a chave real nem dados pessoais. Run: `grep -rL "\$aact" tests/payments/fixtures | wc -l`. Expected: igual ao número de fixtures (nenhuma contém a chave).
- [ ] **Step 3: Payloads de webhook.** Com um túnel (`npx cloudflared tunnel --url http://localhost:3001` ou similar) e um webhook de teste apontando para um endpoint temporário que só registra o corpo, simular pagamento no painel do sandbox e gravar `webhook-payment-received.json`, `webhook-payment-overdue.json` e `webhook-invoice-authorized.json`. Se o túnel não for viável, copiar os exemplos de payload da documentação oficial e registrar isso nos resultados.
- [ ] **Step 4: Escrever o arquivo de resultados**, respondendo às 5 perguntas da spec §9:
  1. carnê com UNDEFINED;
  2. comportamento do link e dos eventos do cartão parcelado;
  3. formato do webhook (id do evento, nomes `INVOICE_*`);
  4. receiveInCash, DELETE de parcelamento e PUT de vencimento;
  5. fiscalInfo e emissão de nota.

  Para cada uma, dizer "confirma a spec" ou "diverge: …".
- [ ] **Step 5: PARAR se houver divergência** que mude a máquina de estados, a criação ou a nota. Relatar ao controlador e aguardar decisão. Sem divergências, seguir.
- [ ] **Step 6: Commit** `git add scripts/asaas-sandbox-probe.mjs tests/payments/fixtures docs/superpowers/plans/2026-11-04-asaas-sandbox-findings.md && git commit -m "chore(pagamentos): verificação do sandbox Asaas e fixtures"`

### Task 2: Banco de dados e tipos

**Files:**
- Create: `supabase/2026-11-04-cobranca-asaas.sql`
- Modify: `supabase/schema.sql`, `src/types/index.ts:117-140`, `tests/supabase/migration.test.ts`

**Interfaces:**
- Produces (TS): `PaymentStatus = 'pending'|'paid'|'overdue'|'cancelled'|'refunded'`; `ChargeKind = 'manual'|'avulsa'|'carne'|'cartao_parcelado'`; `Payment` ganha `budget_id?`, `charge_kind`, `charge_group_id?`, `installment_number?`, `installment_count?`, `provider_charge_id?`, `provider_installment_id?`, `provider_state?: 'creating'|'active'`, `invoice_url?`, `net_amount?`, `alert?: 'chargeback'|'refunded_with_invoice'`, `updated_at?`; `FiscalInvoiceStatus = 'scheduled'|'authorized'|'error'|'cancelling'|'cancelled'`; `FiscalInvoice { id; clinic_id; payment_id; provider_invoice_id; status; number?; value; description; pdf_url?; xml_url?; error?; created_at; updated_at }`.
- Produces (SQL): tabelas e colunas da spec §5, com estes nomes exatos. Índices: `payments(clinic_id, provider_charge_id)` único parcial (`WHERE provider_charge_id IS NOT NULL`); `payments(charge_group_id)`; `payment_events(clinic_id, provider_event_id)` único; `fiscal_invoices(clinic_id, provider_invoice_id)` único parcial; `payment_connections(webhook_token)` único.

- [ ] **Step 1: Escrever o teste que falha** em `tests/supabase/migration.test.ts`:
  - trocar o `describe.each` dos modelos padrão para checar `['2026-11-04-cobranca-asaas.sql', 'schema.sql']` (o arquivo de 02/11 fica como histórico);
  - novos casos:
    - `payment_connections, payment_customers e payment_events não têm CREATE POLICY`: regex sobre o SQL novo;
    - `fiscal_invoices tem policy clinic_member com user_clinic_ids()`;
    - `payments.status aceita cancelled e refunded`;
    - `messages e message_settings aceitam payment_due`;
    - `atualiza o modelo de charge só se ainda for o padrão antigo` (o SQL contém `UPDATE message_settings SET template = ... WHERE type = 'charge' AND template = '<antigo>'`).
- [ ] **Step 2: Rodar** `npx vitest run tests/supabase/migration.test.ts`. Expected: FAIL (arquivo inexistente).
- [ ] **Step 3: Escrever a migração**, que pode rodar mais de uma vez:
  - `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`;
  - CHECKs recriados com `DROP CONSTRAINT IF EXISTS payments_status_check`, `messages_type_check`, `message_settings_type_check` e depois `ADD CONSTRAINT`;
  - `CREATE OR REPLACE FUNCTION public.seed_message_settings` com os 6 tipos (`payment_due` desligado, `{"offset_days":[3]}`);
  - `SELECT public.seed_message_settings(id) FROM clinics;`;
  - UPDATE condicional do modelo de `charge` para o novo padrão (Task 11 define o texto; usar exatamente `DEFAULT_TEMPLATES.charge` e `DEFAULT_TEMPLATES.payment_due`);
  - bloco comentado `cron.schedule('payments-reconcile', '0 9 * * *', ...)` chamando `<APP_URL>/api/cron/payments` com `Authorization: Bearer <CRON_SECRET>`.

  Copiar as definições para o `schema.sql`.
- [ ] **Step 4: Atualizar** `src/types/index.ts` com os tipos acima. Em `src/lib/messaging/types.ts`, acrescentar `'payment_due'` a `MessageType`. Em `templates.ts`, acrescentar `DEFAULT_TEMPLATES.payment_due` e o novo `DEFAULT_TEMPLATES.charge`, com os textos exatos da Task 11, Step 3; esta task é dona desses textos. Também acrescentar um rótulo mínimo `payment_due: 'Lembrete de vencimento'` onde houver `Record<MessageType, …>`, para o `tsc` passar. O planejamento e a tela vêm na Task 11.
- [ ] **Step 5: Rodar** `npx vitest run && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "feat(pagamentos): tabelas de cobrança, notas e conexão Asaas"`

### Task 3: Valores, CPF e parcelas (puro)

**Files:**
- Create: `src/lib/payments/money.ts`, `src/lib/payments/cpf.ts`, `src/lib/payments/installments.ts`
- Test: `tests/payments/installments.test.ts`, `tests/payments/cpf.test.ts`

**Interfaces:**
- Produces:
  - `toCents(reais: number): number` (arredonda);
  - `fromCents(c: number): number`;
  - `normalizeCpf(s: string): string | null` (11 dígitos válidos ou null);
  - `isValidCpf(s: string): boolean`;
  - `splitInstallments(totalCents: number, count: number, firstDueDate: string): { number: number; amountCents: number; dueDate: string }[]`;
  - `validateChargeInput(i: { amountCents: number; installmentCount: number; firstDueDate: string; today: string }): string | null` (mensagem de erro em português ou null).

- [ ] **Step 1: Testes que falham:**
  - `splits 100000 cents in 3 with remainder on last` → `[33333, 33333, 33334]`;
  - `keeps day 31 across short months`: `splitInstallments(30000, 3, '2027-01-31')` → datas `2027-01-31`, `2027-02-28`, `2027-03-31`;
  - `handles leap year`: `'2028-01-31'`, 2x → `2028-02-29`;
  - `crosses year boundary`: `'2026-12-10'`, 3x → `2026-12-10`, `2027-01-10`, `2027-02-10`;
  - `single installment returns one item`;
  - `validateChargeInput`:
    - `amountCents 0` → `'Informe um valor maior que zero'`;
    - `installmentCount 13` → `'Máximo de 12 parcelas'`;
    - `installmentCount 0` → `'Mínimo de 1 parcela'`;
    - `firstDueDate < today` → `'O vencimento não pode ser no passado'`;
    - parcela menor que R$ 5,00 → `'Cada parcela precisa ser de pelo menos R$ 5,00'` (mínimo do Asaas; confirmar o valor no Task 1);
  - CPF:
    - `'529.982.247-25'` válido → `'52998224725'`;
    - `'111.111.111-11'` → null;
    - dígito errado → null.
- [ ] **Step 2: Rodar** `npx vitest run tests/payments`. Expected: FAIL.
- [ ] **Step 3: Implementar.** Cada vencimento é sempre calculado a partir do dia do 1º vencimento (não da parcela anterior), limitado ao último dia do mês.
- [ ] **Step 4: Rodar.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(pagamentos): divisão de parcelas, centavos e CPF"`

### Task 4: Máquina de estados (puro)

**Files:**
- Create: `src/lib/payments/status.ts`
- Test: `tests/payments/status.test.ts`

**Interfaces:**
- Consumes: `ProviderCharge` (Task 5; declare o tipo em `provider.ts` já nesta task, só o tipo).
- Produces:
```ts
type LocalStatus = 'pending'|'paid'|'overdue'|'cancelled'|'refunded'
interface LocalPaymentState { status: LocalStatus; due_date: string | null; hasAuthorizedInvoice: boolean }
interface PaymentPatch {
  status?: LocalStatus; paid_at?: string | null; net_amount_cents?: number | null
  due_date?: string; amount_cents?: number; alert?: 'chargeback' | 'refunded_with_invoice'
  becamePaid?: boolean            // transição para paid nesta aplicação
}
applyPaymentEvent(state: LocalPaymentState, event: string, charge: ProviderCharge, today: string): PaymentPatch | null
applyProviderStatus(state: LocalPaymentState, charge: ProviderCharge, today: string): PaymentPatch | null
```
`null` = nada a mudar. "Aberto conforme vencimento" = `overdue` se `due_date < today`, senão `pending`.

- [ ] **Step 1: Testes que falham**, um por linha da tabela §6.3 da spec, mais:
  - `late OVERDUE does not downgrade paid`;
  - `DELETED does not cancel paid or refunded`;
  - `UPDATED ignored when paid`;
  - `RESTORED only from cancelled and becomes overdue when past due`;
  - `REFUNDED with authorized invoice sets alert refunded_with_invoice`;
  - `RECEIVED twice is idempotent (second returns null)`;
  - `CONFIRMED then RECEIVED updates net_amount without becamePaid`;
  - `unknown event returns null`;
  - `applyProviderStatus`:
    - `RECEIVED_IN_CASH` → paid;
    - `deleted: true` → cancelled;
    - `PENDING` com local `overdue` e vencimento futuro (vencimento alterado) → pending.
- [ ] **Step 2: Rodar.** Expected: FAIL.
- [ ] **Step 3: Implementar** `applyPaymentEvent` e `applyProviderStatus`. O segundo traduz o status do Asaas para o evento equivalente e reaproveita o primeiro.
- [ ] **Step 4: Rodar.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(pagamentos): máquina de estados dos lançamentos"`

### Task 5: Provedor e adaptador Asaas

**Files:**
- Create: `src/lib/payments/provider.ts`, `src/lib/payments/asaas.ts`, `src/lib/payments/index.ts`
- Test: `tests/payments/asaas.test.ts` (fixtures da Task 1)

**Interfaces:**
- Produces: a interface `PaymentProvider` da spec §4, exatamente, mais `parseWebhook(body: unknown): ParsedWebhook | null`;
  - `ProviderCharge { id; installmentId: string|null; installmentNumber: number|null; status: string; deleted: boolean; valueCents; netValueCents: number|null; dueDate; paidAt: string|null; invoiceUrl: string|null; externalReference: string|null }`;
  - `ProviderInvoice { id; status: string; number: string|null; pdfUrl: string|null; xmlUrl: string|null; error: string|null; externalReference: string|null }`;
  - `ParsedWebhook = { eventId: string; event: string; charge?: ProviderCharge; invoice?: ProviderInvoice }`;
  - `class PaymentProviderError extends Error { kind: 'invalid_key'|'validation'|'not_found'|'unavailable' }`;
  - `new AsaasProvider({ apiKey, environment: 'sandbox'|'production', fetchImpl? })`;
  - em `index.ts`: `getProviderForClinic(admin, clinicId): Promise<{ provider: PaymentProvider; connection: PaymentConnection } | null>` e `webhookUrl(): string`. `PaymentConnection` é a linha de `payment_connections`, sem `api_key`.

- [ ] **Step 1: Testes que falham** (fetch falso respondendo com as fixtures):
  - `createCharge carne returns 3 charges in installment order with invoiceUrl`;
  - `createCharge sends notificationDisabled customer and fine/interest`;
  - `createCharge avulsa does not send installment fields`;
  - `card installment uses CREDIT_CARD`;
  - `maps 401 to invalid_key, 400 to validation with Asaas description, 404 to not_found, 500/429/network/timeout to unavailable`;
  - `getCharge maps deleted`;
  - `valueCents from 33.33 is 3333`;
  - `parseWebhook payment and invoice fixtures`;
  - `parseWebhook returns null for unknown shape`;
  - `ensureCustomer sends externalReference = patient id`;
  - `registerWebhook sends authToken, SEQUENTIALLY and the event list`;
  - `webhookUrl prefers ASAAS_WEBHOOK_BASE_URL over APP_URL and trims slash`.
- [ ] **Step 2: Rodar.** Expected: FAIL.
- [ ] **Step 3: Implementar.** Usar a mesma estrutura de `src/lib/whatsapp/evolution.ts`: `request()` com `AbortSignal.timeout(15000)` e helper de leitura segura de JSON. Ajustar o mapeamento aos formatos reais registrados nos resultados da Task 1.
- [ ] **Step 4: Rodar.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(pagamentos): provedor Asaas"`

### Task 6: Conexão (lógica, rotas e repositório base)

**Files:**
- Create: `src/lib/payments/repo.ts`, `src/lib/payments/connection.ts`, `src/app/api/payments/connection/route.ts`
- Test: `tests/payments/connection.test.ts`

**Interfaces:**
- Consumes: `PaymentProvider`, `webhookUrl()`.
- Produces:
  - `connect(input: { clinicId; apiKey; environment }, deps: ConnectionDeps): Promise<{ ok: true; accountName } | { ok: false; status: number; error: string }>`;
  - `disconnect(clinicId, deps)`;
  - `updateSettings(clinicId, patch: { fine_percent?; interest_percent_month?; nfse_auto?; nfse_description?; nfse_service_code?; nfse_iss_rate? }, deps)`: valida faixas (multa 0–2, juros 0–1, ISS 0–5);
  - `markInvalidKey(admin, clinicId)` em `repo.ts`;
  - `toApiError(e: unknown): { status: number; error: string }`: `invalid_key` → 409 `'asaas_invalid_key'` (e quem chama marca a conexão), `validation` → 422 com a mensagem, `unavailable` → 503 `'O Asaas não respondeu. Nada foi alterado. Tente novamente.'`.
  - GET devolve `{ connected, environment, accountName, apiKeyLast4, status, fine_percent, interest_percent_month, nfse_*, fiscal: { configured, missing } | null }`, sem `api_key` e sem `webhook_token`.

- [ ] **Step 1: Testes que falham** (deps falsas):
  - `connect verifies key, registers webhook with 64-hex token, saves last4`;
  - `connect with invalid key returns 422 'Chave inválida para o ambiente escolhido' and saves nothing`;
  - `if saving fails after registerWebhook, removes the webhook`;
  - `reconnect removes old webhook`;
  - `disconnect ignores removeWebhook failure and deletes row`;
  - `updateSettings rejects fine 3`;
  - `GET never includes api_key or webhook_token` (sobre a função que monta a resposta);
  - `returns 409 asaas_invalid_key and flags connection` (via `toApiError` + `markInvalidKey`).
- [ ] **Step 2: Rodar.** Expected: FAIL.
- [ ] **Step 3: Implementar** a lógica, o repo e a rota (GET/POST/PATCH/DELETE).
- [ ] **Step 4: Rodar** `npx vitest run tests/payments && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(pagamentos): conexão com a conta Asaas"`

### Task 7: Criar cobrança

**Files:**
- Create: `src/lib/payments/charges.ts`, `src/app/api/payments/charges/route.ts`
- Modify: `src/lib/payments/repo.ts`
- Test: `tests/payments/charges.test.ts`

**Interfaces:**
- Consumes: `splitInstallments`, `validateChargeInput`, `normalizeCpf`, `PaymentProvider`, `toApiError`.
- Produces:
```ts
interface CreateChargeInput { clinicId; patientId; budgetId?: string|null; amountCents; description
  kind: 'avulsa'|'carne'|'cartao_parcelado'; installmentCount; firstDueDate; cpf?: string|null; sendWhatsApp: boolean }
createCharge(input, deps: ChargeDeps, now: Date): Promise<
  { status: 201; body: { groupId: string; paymentIds: string[]; pending?: true; whatsapp?: { ok: boolean; error?: string } } }
  | { status: number; body: { error: string } }>
```
`ChargeDeps`: `getPatient`, `savePatientCpf`, `getConnection`, `getCustomerId`/`saveCustomerId`, `findRecentDuplicate(clinicId, patientId, amountCents, description, since: Date)`, `insertCreatingRows`, `linkRows(groupId, charges: ProviderCharge[])`, `deleteRows(groupId)`, `provider`, `sendLink(clinicId, paymentId)` (Task 11), `today(clinicId)`.

- [ ] **Step 1: Testes que falham:**
  - `creates 10 carne rows creating, calls provider with externalReference=groupId, links and activates`;
  - `avulsa is one row without installment fields`;
  - `missing CPF on patient and none given → 422 'Informe o CPF do paciente'`;
  - `given CPF is saved to patient`;
  - `invalid CPF → 422 'CPF inválido'`;
  - `no connection → 409 'Conecte o Asaas em Configurações → Pagamentos'`;
  - `invalid_key connection → 409 asaas_invalid_key`;
  - `provider validation error deletes rows and returns 422 with message`;
  - `provider unavailable deletes rows and returns 503 'Nada foi cobrado'`;
  - `leaves rows creating when linking fails after provider success` → 201 com `pending: true`;
  - `duplicate within 30s → 409 'Cobrança igual criada há instantes'`;
  - `sendWhatsApp sends link of first installment only`;
  - `whatsapp failure does not fail the charge`;
  - `budgetId is stored on every row`;
  - `patient or budget of another clinic → 404 'Paciente não encontrado'`.
- [ ] **Step 2: Rodar.** Expected: FAIL.
- [ ] **Step 3: Implementar** `charges.ts`, o repo e a rota. A rota converte o JSON, injeta as deps e responde `status/body`.
- [ ] **Step 4: Rodar.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(pagamentos): criação de cobranças no Asaas"`

### Task 8: Ações sobre o lançamento

**Files:**
- Create: `src/lib/payments/actions.ts`, `src/app/api/payments/[id]/due-date/route.ts`, `.../receive/route.ts`, `.../cancel/route.ts`
- Test: `tests/payments/actions.test.ts`

**Interfaces:**
- Produces:
  - `changeDueDate(clinicId, paymentId, dueDate, deps, now)`;
  - `markReceived(clinicId, paymentId, { paidAt: string; amountCents: number; method?: PaymentMethod }, deps)`;
  - `cancelPayment(clinicId, paymentId, scope: 'one'|'remaining', deps)`.

  Todas devolvem `{ status, body }`. Lançamento manual: só grava. Com Asaas: chama o provedor e, depois, grava com `applyProviderStatus` na resposta.

- [ ] **Step 1: Testes que falham:**
  - `changeDueDate only for pending/overdue → else 409 'Só é possível alterar cobranças em aberto'`;
  - `changeDueDate in the past → 422`;
  - `markReceived on Asaas calls receiveInCash and marks paid`;
  - `markReceived manual just updates`;
  - `cancel paid → 409 'Pagamento recebido não pode ser cancelado. Faça o estorno no painel do Asaas.'`;
  - `cancel remaining calls cancelInstallment and cancels only unpaid rows of the group`;
  - `other clinic's payment → 404`;
  - `invalid_key flags connection`.
- [ ] **Step 2: Rodar.** Expected: FAIL.
- [ ] **Step 3: Implementar** a lógica e as rotas.
- [ ] **Step 4: Rodar.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(pagamentos): alterar vencimento, receber e cancelar"`

### Task 9: Webhook

**Files:**
- Create: `src/lib/payments/events.ts`, `src/app/api/webhooks/asaas/route.ts`
- Modify: `src/proxy.ts` (`/api/webhooks/` já é público; confirmar que cobre `/api/webhooks/asaas`)
- Test: `tests/payments/events.test.ts`

**Interfaces:**
- Consumes: `applyPaymentEvent`, `parseWebhook`, `scheduleInvoiceForPayment` (Task 10; injete como dep).
- Produces: `handleWebhook(token: string|null, body: unknown, deps: EventDeps, now: Date): Promise<{ status: 200|401; result: 'processed'|'ignored'|'failed'|'duplicate' }>`; `reprocessEvent(eventRow, deps, now)` (para a Task 10).

- [ ] **Step 1: Testes que falham:**
  - `unknown or missing token → 401`;
  - `duplicate provider_event_id is a no-op`;
  - `PAYMENT_RECEIVED marks paid and stores net_amount`;
  - `unknown charge id → ignored`;
  - `processing error → event failed with error and status 200`;
  - `nfse_auto schedules invoice on becamePaid`;
  - `nfse_auto off does not schedule`;
  - `card installment schedules one invoice for the group` (N eventos CONFIRMED do mesmo `provider_installment_id` → uma nota, ligada à parcela 1, valor total);
  - `INVOICE_AUTHORIZED updates invoice number/pdf/xml`;
  - `INVOICE_ERROR stores reason`;
  - `INVOICE_CANCELLATION_DENIED returns to authorized`;
  - `REFUNDED with authorized invoice sets alert`.
- [ ] **Step 2: Rodar.** Expected: FAIL.
- [ ] **Step 3: Implementar.** A rota lê o header `asaas-access-token` e o JSON (corpo inválido → 200 `ignored`, se o token for válido).
- [ ] **Step 4: Rodar.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(pagamentos): webhook do Asaas com baixa automática"`

### Task 10: NFS-e e conferência diária

**Files:**
- Create: `src/lib/payments/invoices.ts`, `src/lib/payments/reconcile.ts`, `src/app/api/payments/[id]/invoice/route.ts`, `src/app/api/invoices/[id]/cancel/route.ts`, `src/app/api/cron/payments/route.ts`
- Test: `tests/payments/invoices.test.ts`, `tests/payments/reconcile.test.ts`

**Interfaces:**
- Produces:
  - `scheduleInvoiceForPayment(clinicId, paymentId, opts: { description?: string; valueCents?: number }, deps)`:
    - só `paid` sem nota `scheduled`/`authorized`;
    - manual → cliente pelo `ensureCustomer`;
    - cartão parcelado → `installmentId` e valor total;
    - descrição de `nfse_description` com `{descricao}` = `payments.description`;
    - grava `fiscal_invoices` como `scheduled`.
  - `cancelInvoice(clinicId, invoiceId, deps)`: `authorized` → `cancelling`.
  - `reconcileAll(deps, now, deadline): Promise<Record<clinicId, { completed; deleted; updated; invoices; reprocessed; error? }>>`.
  - A rota de cron reusa o `authorized()` de `api/cron/messages/route.ts`; extraia-o para `src/lib/auth/cronAuth.ts`, usado pelas duas.

- [ ] **Step 1: Testes que falham (notas):**
  - `rejects unpaid → 409 'A nota só pode ser emitida para pagamentos recebidos'`;
  - `rejects when active invoice exists`;
  - `retry after error creates a new row and keeps the old`;
  - `manual payment without CPF → 422 'Informe o CPF do paciente'`;
  - `fiscal not configured → 409 'Configure a nota fiscal no painel do Asaas'`;
  - `cancel only authorized`.
- [ ] **Step 2: Testes que falham (conferência):**
  - `completes creating group by externalReference`;
  - `deletes creating rows older than 1h with no provider charge`;
  - `keeps creating rows younger than 10 min untouched`;
  - `updates pending to paid from provider status`;
  - `refreshes scheduled invoices older than 1h`;
  - `reprocesses failed events`;
  - `purges processed events older than 90 days`;
  - `marks invalid_key and continues with next clinic`;
  - `stops before deadline`.
- [ ] **Step 3: Rodar.** Expected: FAIL.
- [ ] **Step 4: Implementar** a lógica e as rotas. Em `connection.ts`, o GET inclui `getFiscalStatus()` (falha → `fiscal: null`).
- [ ] **Step 5: Rodar.** Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "feat(pagamentos): NFS-e e conferência diária"`

### Task 11: Mensagens: lembrete de vencimento, {link} e envio do link

**Files:**
- Create: `src/lib/messaging/manualDeps.ts`, `src/lib/payments/notify.ts`, `src/app/api/payments/[id]/send-link/route.ts`, `src/app/api/invoices/[id]/send/route.ts`
- Modify: `src/lib/messaging/types.ts`, `templates.ts`, `schedule.ts`, `cycleData.ts`, `src/app/api/messages/send/route.ts` (usar `createManualDeps`), `src/components/mensagens/helpers.ts`, `TabAutomaticas.tsx`, `ModalEnviarWhatsApp.tsx`
- Test: `tests/messaging/schedule.test.ts`, `tests/messaging/templates.test.ts`, `tests/payments/notify.test.ts`

**Interfaces:**
- Produces:
  - `MessageType` ganha `'payment_due'`;
  - `TemplateContext` ganha `link?: string`;
  - `PaymentRow` ganha `invoice_url: string|null` e `provider_state: string|null`;
  - `MANUAL_TEMPLATES = { payment_link, invoice }`;
  - `createManualDeps(admin): ManualDeps`;
  - `sendPaymentLink(admin, clinicId, paymentId)` e `sendInvoiceLink(admin, clinicId, invoiceId)`: devolvem `ManualResult`.

- [ ] **Step 1: Testes que falham:**
  - `plans payment_due 3 days before due for pending payment with invoice_url`;
  - `no payment_due without invoice_url`;
  - `no charge/payment_due for provider_state creating`;
  - `dedupe key payment_due:<id>:3`;
  - `staleReason charge/payment_due for cancelled and refunded → 'paid'`;
  - `renderTemplate fills {link}`;
  - `charge default with empty link has no trailing 'Pague por aqui'`, o que exige a linha do link ser apenas `{link}`;
  - `sendPaymentLink renders MANUAL_TEMPLATES.payment_link with valor/vencimento/link and refuses payment without invoice_url (422 'Esta cobrança não tem link')`.
- [ ] **Step 2: Rodar.** Expected: FAIL.
- [ ] **Step 3: Implementar.** Textos exatos (`payment_due` e `charge` já foram gravados na Task 2; aqui, só conferir):
  - `payment_due`: `'Olá, {paciente}! Sua parcela de {valor} na {clinica} vence em {vencimento}. Pague por aqui: {link}'`;
  - `charge`: o atual + `'\n\n{link}'`;
  - `MANUAL_TEMPLATES.payment_link`: `'Olá, {paciente}! Segue o link para o pagamento de {valor} com vencimento em {vencimento}: {link}'`;
  - `MANUAL_TEMPLATES.invoice`: `'Olá, {paciente}! Segue a nota fiscal do seu pagamento de {valor}: {link}'`.

  Também:
  - `cycleData` passa a selecionar `invoice_url, provider_state`;
  - adicionar `payment_due` a `SETTING_ORDER` e ao cartão de Automáticas, com "dias antes do vencimento";
  - adicionar "Link de pagamento" à lista do modal manual, preenchendo `{link}` com o pagamento em aberto mais próximo que tenha link.
- [ ] **Step 4: Rodar** `npx vitest run && npx tsc --noEmit`. Expected: PASS (todos os testes antigos continuam passando).
- [ ] **Step 5: Commit** `git commit -m "feat(mensagens): lembrete de vencimento e link de pagamento"`

### Task 12: Tela Configurações → Pagamentos

**Files:**
- Create: `src/app/(dashboard)/configuracoes/pagamentos/page.tsx`, `src/components/pagamentos/AsaasBanner.tsx`
- Modify: `src/app/(dashboard)/configuracoes/page.tsx` (novo card "Pagamentos"), `src/app/(dashboard)/financeiro/page.tsx` (banner)

**Interfaces:**
- Consumes: `/api/payments/connection` (GET/POST/PATCH/DELETE).

- [ ] **Step 1: Implementar** conforme a spec §8:
  - formulário de chave e ambiente;
  - estado "Conectado · conta X · chave final ...1234" com "Trocar chave" e "Desconectar" (confirmação com o aviso da §6.1);
  - multa e juros;
  - seção de nota fiscal: estado fiscal, com link para o painel do Asaas quando faltar configuração; descrição; código; ISS; chave "Emitir automaticamente ao receber";
  - aviso para clínica sem `clinics.cnpj`: "Nota fiscal de serviço é para clínicas com CNPJ".

  `AsaasBanner` mostra "Reconecte o Asaas" quando `status = 'invalid_key'`.
- [ ] **Step 2: Verificar** `npx tsc --noEmit && npx eslint src/app/(dashboard)/configuracoes/pagamentos src/components/pagamentos` e abrir `/configuracoes/pagamentos` no `npm run dev`. Com uma chave sandbox, conectar, trocar e desconectar.
- [ ] **Step 3: Commit** `git commit -m "feat(pagamentos): tela de configurações de pagamento"`

### Task 13: Nova cobrança e orçamento

**Files:**
- Create: `src/components/pagamentos/ModalNovaCobranca.tsx`
- Modify: `src/components/paciente/TabOrcamentos.tsx`, `src/app/(dashboard)/pacientes/[id]/page.tsx`

**Interfaces:**
- Consumes: `POST /api/payments/charges`; `splitInstallments` (para o resumo); `normalizeCpf`; status do WhatsApp por `useWhatsAppStatus` (`src/components/agenda/useWhatsAppStatus.ts`) e `patient.whatsapp_opt_out`.
- Produces: `<ModalNovaCobranca patient budget? onClose onCreated />`.

- [ ] **Step 1: Implementar** a janela da spec §8:
  - modos: à vista, carnê, cartão parcelado e "Registrar sem link";
  - o modo "Registrar sem link" grava direto em `payments` pelo cliente Supabase, com `charge_kind='manual'`, `payment_method`, `status` `paid`/`pending`, `paid_at`;
  - resumo "10x de R$ 200,00 · vencimentos 10/12 a 10/09";
  - CPF só se faltar;
  - caixa "Enviar link agora pelo WhatsApp", desmarcada e com o motivo quando o WhatsApp está desconectado ou o paciente fez opt-out;
  - erros da API exibidos como vierem; `pending: true` mostra "Cobrança enviada ao Asaas; a confirmação pode levar alguns minutos";
  - sem conexão Asaas, só "Registrar sem link", com o link "Conectar o Asaas".
- [ ] **Step 2: Orçamento:**
  - "Aprovar" muda o status e abre a janela com valor = `total` e descrição `Orçamento #<n>`; "Cobrar depois" só fecha;
  - cada orçamento mostra "Cobrado R$ X de R$ Y" (soma de `payments` com `budget_id`, sem `cancelled`/`refunded`).
- [ ] **Step 3: Aba Pagamentos:** botão "Nova cobrança".
- [ ] **Step 4: Verificar** `npx tsc --noEmit`, lint e, no navegador com o sandbox: gerar à vista, carnê 3x e cartão 3x; registrar pagamento em dinheiro.
- [ ] **Step 5: Commit** `git commit -m "feat(pagamentos): janela de nova cobrança e cobrança pelo orçamento"`

### Task 14: Lista de pagamentos, ações e notas

**Files:**
- Create: `src/components/pagamentos/ListaPagamentos.tsx`, `src/components/pagamentos/ModalEmitirNota.tsx`
- Modify: `src/app/(dashboard)/pacientes/[id]/page.tsx` (aba Pagamentos), `src/app/(dashboard)/financeiro/page.tsx`

**Interfaces:**
- Consumes: rotas das Tasks 8, 10 e 11; `fiscal_invoices` lido pelo cliente Supabase (RLS).
- Produces: `<ListaPagamentos payments invoices showPatient? onChanged />`.

- [ ] **Step 1: Implementar:**
  - linha com "Parcela n/N", situação (a vencer, pago, atrasado, cancelado, estornado), ícone de nota (agendada, emitida, erro) e alertas da spec §7;
  - menu: Copiar link, Enviar link pelo WhatsApp, Alterar vencimento, Marcar como pago, Cancelar (no carnê, pergunta "Só esta parcela" / "Esta e as próximas não pagas"), Emitir nota, Ver PDF, Enviar nota pelo WhatsApp, Cancelar nota, Tentar novamente;
  - ações indisponíveis ficam ocultas;
  - `ModalEmitirNota` com valor e descrição editáveis.

  No Financeiro: mesmas colunas, banner e as somas atuais, sem `cancelled`/`refunded`.
- [ ] **Step 2: Verificar** `npx tsc --noEmit`, lint e, no navegador, cada ação em lançamentos do sandbox.
- [ ] **Step 3: Commit** `git commit -m "feat(pagamentos): ações e notas na lista de pagamentos"`

### Task 15: Documentação e teste de ponta a ponta

**Files:**
- Modify: `README.md` (seção "Cobrança integrada (Asaas)"), `.env.example` (`ASAAS_WEBHOOK_BASE_URL`, comentado como opcional)

- [ ] **Step 1: README:**
  - como criar a conta, sandbox e produção;
  - onde pegar a chave;
  - aplicar `supabase/2026-11-04-cobranca-asaas.sql`;
  - agendar a conferência;
  - túnel para teste local;
  - taxas aproximadas, com link para a tabela oficial;
  - configuração fiscal no painel do Asaas.
- [ ] **Step 2: Rodar** `npx vitest run && npx tsc --noEmit && npm run build`. Expected: tudo verde.
- [ ] **Step 3: Teste de ponta a ponta com o usuário** (sandbox + túnel):
  - conectar;
  - gerar à vista, carnê e cartão;
  - simular pagamento no painel → lançamento pago;
  - vencer uma parcela → atrasado;
  - alterar vencimento;
  - cancelar o restante;
  - marcar como pago;
  - emitir nota de teste;
  - enviar o link pelo WhatsApp;
  - disparar `/api/cron/payments` à mão.
- [ ] **Step 4: Commit** `git commit -m "docs: cobrança integrada com Asaas"`
