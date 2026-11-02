# WhatsApp automático — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A clínica conecta o próprio WhatsApp por QR Code e o app envia sozinho confirmação (com resposta 1/2 que atualiza a agenda), lembrete, retorno, aniversário e cobrança, além de envio manual e histórico.

**Architecture:** Lógica de negócio em funções puras e testáveis (`src/lib/messaging/*`), um provedor de WhatsApp atrás de uma interface (`src/lib/whatsapp/*`, implementação Evolution API), e rotas Next.js (`src/app/api/*`) que fazem a ponte com o banco. Uma tabela `messages` é fila e histórico; o Supabase `pg_cron` chama `/api/cron/messages` a cada 5 min.

**Tech Stack:** Next.js 16 (App Router, route handlers), React 19, Supabase (Postgres + RLS + pg_cron/pg_net), Evolution API v2, Vitest, `@date-fns/tz`.

**Spec:** `docs/superpowers/specs/2026-11-02-whatsapp-automatico-design.md`

## Global Constraints

- Next.js 16 tem mudanças incompatíveis: antes de escrever qualquer route handler, ler `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` (ex.: `params` é `Promise`, use `RouteContext<'/rota/[id]'>`).
- Fuso padrão da clínica: `America/Sao_Paulo`. Toda decisão de "hoje", "9h", janela de envio usa o fuso de `clinics.messaging_config.timezone`, nunca o fuso do servidor.
- Padrões: janela `08:00`–`20:00`, `daily_limit` 300, intervalo aleatório 3–8 s entre envios, máximo 3 tentativas com 5 min entre elas, ciclo para em ~50 s, item `sending` há mais de 10 min volta para `queued`.
- Padrões por tipo: confirmation `offset_hours: 24`; reminder `offset_hours: 2`; recall `offset_months: 6`; birthday às `09:00`; charge `offset_days: [1, 7]`.
- Janela de resposta à confirmação: 48 h.
- Telefone canônico: `55` + DDD + 9 dígitos (13 dígitos). Fixo não recebe mensagem.
- Texto de interface em português do Brasil. Estilo visual: seguir as telas existentes (cores `#3B82F6`, `#111827`, `#6B7280`, `#E5E7EB`, cards `rounded-xl border`).
- `whatsapp_connections` e escrita em `messages` só pelo servidor (service role). Nunca expor token de instância ou `SUPABASE_SERVICE_ROLE_KEY` ao navegador.
- Novas variáveis de ambiente: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `CRON_SECRET`, `EVOLUTION_WEBHOOK_TOKEN`, `APP_URL`.
- Depende do item 0 (`supabase/2026-11-02-isolamento-por-clinica.sql`), que cria `public.user_clinic_ids()`.

## Review Focus

1. **Consulta remarcada depois da confirmação enviada** — paciente responde "1" à mensagem do horário antigo: a resposta não pode confirmar o novo horário. → teste em Task 5 (`ignores confirmation whose start_time no longer matches`).
2. **Virada do dia no fuso da clínica** — às 22h em São Paulo (01h UTC do dia seguinte) não pode gerar aniversário/cobrança de "amanhã", nem considerar fora/dentro da janela pelo relógio UTC. → testes em Task 3 e Task 4.
3. **Número do WhatsApp sem o 9** — o WhatsApp entrega `551187654321@s.whatsapp.net` para números antigos; deve casar com o paciente cadastrado como `(11) 98765-4321`. → teste em Task 1 e Task 9.
4. **Webhook com mensagem que não é texto do paciente** — grupo (`@g.us`), mensagem própria (`fromMe`), áudio/figurinha, status/broadcast: ignorar com 200, sem erro e sem gravar. → teste em Task 7.
5. **Modelo editado com variável errada ou vazio** — `{pacinete}` permanece literal e o editor avisa; salvar texto vazio é bloqueado. → testes em Task 2 e Task 12.

---

## File Structure

```
vitest.config.ts                              Vitest (alias @ → src)
src/lib/messaging/
  types.ts           tipos compartilhados (MessageType, QueueItem, MessagingConfig, MessageSetting, linhas do banco)
  phone.ts           normalizePhone
  time.ts            helpers de fuso (zonedNow parts, atTime, formatos pt-BR)
  templates.ts       renderTemplate, findUnknownVariables, DEFAULT_TEMPLATES, TEMPLATE_VARIABLES, buildContext
  window.ts          isWithinSendWindow, startOfClinicDay
  schedule.ts        planMessages (puro) + staleReason (puro, usado na limpeza)
  replies.ts         parseReply, pickConfirmationTarget
  sender.ts          processQueue (depende de QueueRepo + WhatsAppProvider)
  repo.ts            QueueRepo (interface) + createSupabaseQueueRepo
  cycle.ts           runCycle: carrega dados do banco → planMessages → upsert → limpeza → processQueue
  incoming.ts        handleIncoming (webhook → histórico → ação na consulta → auto_reply)
src/lib/whatsapp/
  provider.ts        interface WhatsAppProvider, ConnectionStatus, WebhookEvent, erros
  evolution.ts       EvolutionProvider
  index.ts           getProvider()
src/lib/supabase/admin.ts                     cliente service role (somente servidor)
src/lib/auth/currentClinic.ts                 getCurrentClinic() para rotas autenticadas
src/app/api/whatsapp/{connect,status,disconnect}/route.ts
src/app/api/messages/send/route.ts
src/app/api/messages/[id]/retry/route.ts
src/app/api/cron/messages/route.ts
src/app/api/webhooks/evolution/route.ts
src/components/mensagens/{TabAutomaticas,TabHistorico,ModalEnviarWhatsApp,WhatsAppBanner}.tsx
supabase/2026-11-02-whatsapp-automatico.sql   migração (+ incorporada ao schema.sql)
docker-compose.evolution.yml                  Evolution local para desenvolvimento
tests/messaging/*.test.ts, tests/whatsapp/*.test.ts
```

Modificados: `package.json`, `src/proxy.ts`, `src/types/index.ts`, `supabase/schema.sql`, `.env.example`, `README.md`, `src/app/(dashboard)/configuracoes/mensagens/page.tsx`, `src/app/(dashboard)/mensagens/page.tsx`, `src/app/(dashboard)/pacientes/[id]/page.tsx`, `src/components/paciente/ModalEditarPaciente.tsx`, `src/components/agenda/CalendarioAgenda.tsx` (ou `PopoverConsulta.tsx`), `src/app/(dashboard)/layout.tsx`.

---

### Task 1: Vitest + normalização de telefone

**Files:**
- Create: `vitest.config.ts`, `src/lib/messaging/phone.ts`, `tests/messaging/phone.test.ts`
- Modify: `package.json` (devDependency `vitest`; script `"test": "vitest run"`)

**Interfaces:**
- Produces: `normalizePhone(raw: string | null | undefined): string | null`

- [ ] **Step 1: Instalar** `npm i -D vitest` e criar `vitest.config.ts` com `resolve.alias: { '@': path.resolve(__dirname, 'src') }` e `test.include: ['tests/**/*.test.ts']`.
- [ ] **Step 2: Escrever o teste que falha**

```ts
describe('normalizePhone', () => {
  it.each([
    ['(11) 98765-4321', '5511987654321'],
    ['11987654321', '5511987654321'],
    ['5511987654321', '5511987654321'],
    ['+55 11 98765-4321', '5511987654321'],
    ['011987654321', '5511987654321'],
    ['1187654321', '5511987654321'],      // celular sem o 9
    ['551187654321', '5511987654321'],    // JID antigo do WhatsApp, sem o 9
  ])('%s → %s', (raw, out) => expect(normalizePhone(raw)).toBe(out))
  it.each([['1133334444'], ['551133334444'], ['123'], [''], [null], [undefined], ['abc']])(
    'rejeita %s', (raw) => expect(normalizePhone(raw as any)).toBeNull())
})
```

- [ ] **Step 3:** `npx vitest run tests/messaging/phone.test.ts` → FAIL (módulo não existe).
- [ ] **Step 4: Implementar `normalizePhone`** seguindo a regra da spec §7: só dígitos; tira `0` inicial; 10/11 dígitos → prefixa `55`; 12 dígitos com `55` e primeiro dígito local 6–9 → insere `9` após o DDD; aceita só 13 dígitos começando com `55` e com `9` na posição 5 (índice 4); senão `null`.
- [ ] **Step 5:** rodar de novo → PASS.
- [ ] **Step 6: Commit** `git add vitest.config.ts package.json package-lock.json src/lib/messaging/phone.ts tests/messaging/phone.test.ts && git commit -m "feat(mensagens): Vitest e normalização de telefone"`

---

### Task 2: Tipos, helpers de fuso e modelos de texto

**Files:**
- Create: `src/lib/messaging/types.ts`, `src/lib/messaging/time.ts`, `src/lib/messaging/templates.ts`, `tests/messaging/templates.test.ts`
- Modify: `package.json` (dependency `@date-fns/tz`)

**Interfaces:**
- Produces (types.ts):
  ```ts
  export type MessageType = 'confirmation' | 'reminder' | 'recall' | 'birthday' | 'charge'
  export type MessageKind = MessageType | 'manual' | 'auto_reply' | 'incoming'
  export type MessageStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled' | 'received'
  export interface MessagingConfig { window_start: string; window_end: string; daily_limit: number; timezone: string }
  export interface MessageSetting { type: MessageType; enabled: boolean; template: string
    config: { offset_hours?: number; offset_months?: number; offset_days?: number[] } }
  export interface PatientRow { id: string; name: string; phone: string | null; whatsapp: string | null
    birthdate: string | null; whatsapp_opt_out: boolean }
  export interface AppointmentRow { id: string; patient_id: string; professional_name: string | null
    start_time: string; status: string }
  export interface PaymentRow { id: string; patient_id: string; amount: number; due_date: string | null; status: string }
  export interface QueueItem { clinic_id: string; patient_id: string; appointment_id: string | null
    payment_id: string | null; type: MessageType; phone: string; body: string
    scheduled_for: Date; expires_at: Date | null; dedupe_key: string }
  export interface TemplateContext { paciente?: string; paciente_completo?: string; data?: string; hora?: string
    profissional?: string; clinica?: string; valor?: string; vencimento?: string }
  ```
- Produces (time.ts): `zonedParts(d: Date, tz: string): { year; month; day; hour; minute; weekday }`, `zonedDateTime(ymd: string, hhmm: string, tz: string): Date`, `todayYmd(now: Date, tz: string): string`, `formatDataCurta(d: Date, tz): string` ("terça, 04/11"), `formatHora(d, tz)` ("14:30"), `formatDataLonga(ymd: string)` ("04/11/2026"), `formatValor(n: number)` ("R$ 150,00").
- Produces (templates.ts): `TEMPLATE_VARIABLES: (keyof TemplateContext)[]`, `DEFAULT_TEMPLATES: Record<MessageType, string>`, `renderTemplate(t: string, ctx: TemplateContext): string`, `findUnknownVariables(t: string): string[]`, `buildContext(args: { patient: PatientRow; clinicName: string; tz: string; appointment?: AppointmentRow; payment?: PaymentRow }): TemplateContext`.

`DEFAULT_TEMPLATES` (texto exato):
- confirmation: `Olá, {paciente}! Sua consulta na {clinica} está marcada para {data} às {hora} com {profissional}.\n\nResponda *1* para confirmar ou *2* para desmarcar.`
- reminder: `Olá, {paciente}! Lembrete: sua consulta na {clinica} é hoje às {hora}. Até logo!`
- recall: `Olá, {paciente}! Já faz um tempo desde sua última visita à {clinica}. Que tal agendar sua revisão? É só responder esta mensagem.`
- birthday: `Feliz aniversário, {paciente}! 🎉 A equipe da {clinica} deseja um dia muito especial para você.`
- charge: `Olá, {paciente}. Identificamos um pagamento de {valor} com vencimento em {vencimento} ainda em aberto na {clinica}. Se já pagou, desconsidere esta mensagem.`

- [ ] **Step 1: Testes que falham** (`tests/messaging/templates.test.ts`):
  - `renderTemplate('Oi {paciente} às {hora}', { paciente: 'Maria', hora: '14:30' })` → `'Oi Maria às 14:30'`
  - variável conhecida sem valor vira vazio: `renderTemplate('{paciente}|{valor}', { paciente: 'A' })` → `'A|'`
  - variável desconhecida fica literal: `renderTemplate('Oi {pacinete}', {})` → `'Oi {pacinete}'`; `findUnknownVariables('Oi {pacinete} {paciente}')` → `['pacinete']`
  - `buildContext` com paciente `'Maria Silva Santos'`, consulta `start_time: '2026-11-04T17:30:00Z'`, tz `America/Sao_Paulo` → `paciente: 'Maria'`, `paciente_completo: 'Maria Silva Santos'`, `data: 'quarta, 04/11'`, `hora: '14:30'`
  - pagamento `amount: 150, due_date: '2026-11-04'` → `valor: 'R$ 150,00'`, `vencimento: '04/11/2026'`
  - `zonedDateTime('2026-11-04', '09:00', 'America/Sao_Paulo').toISOString()` → `'2026-11-04T12:00:00.000Z'`
  - `todayYmd(new Date('2026-11-05T01:00:00Z'), 'America/Sao_Paulo')` → `'2026-11-04'`
- [ ] **Step 2:** `npx vitest run tests/messaging/templates.test.ts` → FAIL.
- [ ] **Step 3: Implementar** `types.ts`, `time.ts` (usar `TZDate` de `@date-fns/tz` + `format` de `date-fns` com `locale: ptBR`), `templates.ts` (regex `/\{(\w+)\}/g`; substitui só chaves em `TEMPLATE_VARIABLES`).
- [ ] **Step 4:** rodar → PASS.
- [ ] **Step 5: Commit** `feat(mensagens): tipos, fuso horário e modelos de texto`

---

### Task 3: Janela de envio

**Files:**
- Create: `src/lib/messaging/window.ts`, `tests/messaging/window.test.ts`

**Interfaces:**
- Consumes: `MessagingConfig`, `zonedParts`, `zonedDateTime`, `todayYmd` (Task 2)
- Produces: `isWithinSendWindow(now: Date, cfg: MessagingConfig): boolean`, `startOfClinicDay(now: Date, tz: string): Date`, `windowStartToday(now: Date, cfg: MessagingConfig): Date`

- [ ] **Step 1: Testes que falham** (cfg padrão, SP = UTC−3):
  - `10:59Z` (07:59 SP) → false; `11:00Z` (08:00 SP) → true; `22:59Z` (19:59 SP) → true; `23:00Z` (20:00 SP) → false
  - `2026-11-05T01:00:00Z` (22:00 SP do dia 04) → false
  - `startOfClinicDay(new Date('2026-11-05T01:00:00Z'), tz).toISOString()` → `'2026-11-04T03:00:00.000Z'`
- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar. **Step 4:** rodar → PASS.
- [ ] **Step 5: Commit** `feat(mensagens): janela de envio no fuso da clínica`

---

### Task 4: Planejador de mensagens (puro)

**Files:**
- Create: `src/lib/messaging/schedule.ts`, `tests/messaging/schedule.test.ts`

**Interfaces:**
- Consumes: tipos e `buildContext`/`renderTemplate` (Task 2), `normalizePhone` (Task 1), `zonedDateTime`/`todayYmd` (Task 2), `windowStartToday` (Task 3)
- Produces:
  ```ts
  export interface PlanInput {
    now: Date; clinicId: string; clinicName: string; cfg: MessagingConfig; settings: MessageSetting[]
    patients: Map<string, PatientRow>
    upcoming: AppointmentRow[]              // start_time em (now, now + 48h], status scheduled|confirmed
    lastCompleted: { patient_id: string; appointment_id: string; start_time: string }[]  // última concluída por paciente
    patientsWithFuture: Set<string>         // têm consulta futura não cancelada
    payments: PaymentRow[]                  // status pending|overdue com due_date
  }
  export function planMessages(input: PlanInput): QueueItem[]
  export function dedupeKey(type: MessageType, parts: { appointmentId?: string; startTime?: string;
    patientId?: string; lastAppointmentId?: string; year?: number; paymentId?: string; offsetDays?: number }): string
  export type StaleReason = 'appointment_changed' | 'not_confirmed' | 'paid' | 'opt_out' | 'expired' | null
  export function staleReason(item: { type: MessageKind; dedupe_key: string | null; expires_at: string | null },
    now: Date, ctx: { appointment?: { start_time: string; status: string } | null; payment?: { status: string } | null;
    patient?: { whatsapp_opt_out: boolean } | null }): StaleReason
  ```
- Regras e chaves: exatamente as da spec §5 ("Chaves anti-duplicidade") e §6.2 passo 1. Telefone = `normalizePhone(patient.whatsapp) ?? normalizePhone(patient.phone)`; sem telefone ou `whatsapp_opt_out` → não planeja. Tipo com `enabled: false` → não planeja. `scheduled_for`: confirmation/reminder = `now`; recall = `windowStartToday`; birthday = hoje 09:00 no fuso; charge = `windowStartToday`. `expires_at`: confirmation/reminder = `start_time`; birthday = hoje `window_end`; recall/charge = `null`.

- [ ] **Step 1: Testes que falham** (`now = 2026-11-03T13:00:00Z`, todos os tipos habilitados com configs padrão):
  - consulta `scheduled` às `2026-11-04T12:00:00Z` (23 h depois) → 1 item `confirmation`, `dedupe_key: 'confirmation:<id>:2026-11-04T12:00:00.000Z'`, `expires_at` = start_time
  - consulta `scheduled` 25 h depois → nenhuma confirmação
  - consulta `confirmed` 1 h depois → `reminder`; consulta `scheduled` 1 h depois → **sem** reminder
  - paciente com `whatsapp_opt_out: true` → nenhum item; paciente com só telefone fixo → nenhum item
  - tipo `confirmation` com `enabled: false` → nenhum item
  - recall: última concluída `2026-05-01`, sem futura → `recall:<patient>:<appt>`; com futura (`patientsWithFuture` contém) → nada; concluída `2026-06-01` → nada
  - birthday: `birthdate: '1990-11-03'` → `birthday:<patient>:2026`, `scheduled_for` = `2026-11-03T12:00:00Z`
  - birthday com `now = 2026-11-04T01:00:00Z` (22h SP do dia 03) e `birthdate '1990-11-04'` → **nada** (Review Focus 2)
  - birthday `'2000-02-29'` com `now` em `2027-02-28T13:00:00Z` → item; em `2028-02-28` → nada (2028 é bissexto)
  - charge: `due_date '2026-11-02'` (D+1) → `charge:<pay>:1`; `'2026-10-27'` (D+7) → `charge:<pay>:7`; `'2026-10-30'` → nada; `status 'paid'` → nada
  - `staleReason`: confirmation cuja chave tem start_time diferente do atual → `'appointment_changed'`; consulta `cancelled`/`no_show` → `'appointment_changed'`; reminder com consulta `scheduled` → `'not_confirmed'`; charge com pagamento `paid` → `'paid'`; paciente opt-out → `'opt_out'`; `expires_at` no passado → `'expired'`; caso válido → `null`
  - corpo renderizado: confirmation contém `'Responda *1* para confirmar'` e o primeiro nome do paciente
- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar. **Step 4:** rodar → PASS.
- [ ] **Step 5: Commit** `feat(mensagens): planejador de mensagens automáticas`

---

### Task 5: Interpretação de respostas

**Files:**
- Create: `src/lib/messaging/replies.ts`, `tests/messaging/replies.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function parseReply(text: string): 'confirm' | 'cancel' | null
  export interface SentConfirmation { message_id: string; appointment_id: string; sent_at: string
    dedupe_key: string; appointment: { start_time: string; status: string } }
  export function pickConfirmationTarget(candidates: SentConfirmation[], now: Date): SentConfirmation | null
  ```

- [ ] **Step 1: Testes que falham:**
  - `parseReply`: `'1'`, `' 1 '`, `'Sim'`, `'confirmo'`, `'1.'` → `'confirm'`; `'2'`, `'Não'`, `'nao'`, `'cancelar'` → `'cancel'`; `'12'`, `'pode ser às 15h?'`, `''` → `null`
  - `pickConfirmationTarget` com `now = 2026-11-03T13:00Z`: escolhe a de `sent_at` mais recente entre válidas; ignora `sent_at` há mais de 48 h; ignora consulta que já começou; ignora consulta `cancelled`/`completed`; **ignores confirmation whose start_time no longer matches** (chave `confirmation:<id>:<antigo>` com `appointment.start_time` novo → descartada) (Review Focus 1); lista vazia → `null`
- [ ] **Step 2:** FAIL. **Step 3:** implementar (normaliza com `trim`, minúsculas, remove acentos e pontuação final). **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(mensagens): interpretação das respostas 1/2`

---

### Task 6: Banco de dados, cliente admin e rotas públicas

**Files:**
- Create: `supabase/2026-11-02-whatsapp-automatico.sql`, `src/lib/supabase/admin.ts`, `src/lib/auth/currentClinic.ts`
- Modify: `supabase/schema.sql` (incorporar no fim, antes do Storage), `src/types/index.ts` (`Patient.whatsapp_opt_out?: boolean`), `.env.example`, `src/proxy.ts`

**Interfaces:**
- Produces: `createAdminClient(): SupabaseClient` (service role, `auth.persistSession: false`; lança erro se a env faltar); `getCurrentClinic(): Promise<{ userId: string; clinicId: string } | null>` (usa `createClient` de `src/lib/supabase/server.ts`, busca `professionals` do usuário).

- [ ] **Step 1: Escrever a migração** com o SQL da spec §5 (tabelas `whatsapp_connections`, `message_settings`, `messages`, índices, `patients.whatsapp_opt_out`, `clinics.messaging_config`) e as policies de RLS da spec (usando `public.user_clinic_ids()`). Incluir:
  - função `public.seed_message_settings(p_clinic UUID)` que insere as 5 linhas com `enabled = false`, os textos de `DEFAULT_TEMPLATES` (Task 2) e configs padrão, `ON CONFLICT DO NOTHING`;
  - `SELECT public.seed_message_settings(id) FROM clinics;` para clínicas existentes;
  - `handle_new_user()` recriada chamando `seed_message_settings(new_clinic_id)`;
  - `CREATE EXTENSION IF NOT EXISTS pg_cron; CREATE EXTENSION IF NOT EXISTS pg_net;` e, **comentado**, o `cron.schedule('whatsapp-messages', '*/5 * * * *', $$ SELECT net.http_post(url := '<APP_URL>/api/cron/messages', headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'), timeout_milliseconds := 60000) $$);`.
- [ ] **Step 2: `src/proxy.ts`** — `/api/cron` e `/api/webhooks` passam direto (sem redirecionar para `/login`); as demais `/api/*` sem usuário recebem `401` JSON em vez de redirect.
- [ ] **Step 3: `.env.example`** — acrescentar as 5 variáveis novas com comentário de uma linha cada.
- [ ] **Step 4: Verificar** — pedir ao usuário para rodar a migração no SQL Editor; depois `node --env-file=.env.local -e` consultando via service role: `message_settings` tem 5 linhas por clínica; com o usuário de teste do item 0 (`rls-teste@example.com`), `messages`/`message_settings` de outra clínica retornam 0 linhas; `whatsapp_connections` retorna 0 linhas para usuário logado mesmo da própria clínica. `npx tsc --noEmit` sem erros. `curl -s -o /dev/null -w "%{http_code}" -X POST localhost:3001/api/cron/messages` → não é `307`.
- [ ] **Step 5: Commit** `feat(mensagens): tabelas, RLS e rotas públicas para cron/webhook`

---

### Task 7: Provedor WhatsApp + Evolution API

**Files:**
- Create: `src/lib/whatsapp/provider.ts`, `src/lib/whatsapp/evolution.ts`, `src/lib/whatsapp/index.ts`, `tests/whatsapp/evolution.test.ts`, `tests/whatsapp/fixtures/*.json`

**Interfaces:**
- Produces: a interface `WhatsAppProvider`, `ConnectionStatus` e `WebhookEvent` exatamente como na spec §4; `class PermanentSendError extends Error`, `class TransientSendError extends Error`; `getProvider(): WhatsAppProvider`; `new EvolutionProvider({ baseUrl, apiKey, webhookUrl, fetchImpl? })`.

Mapeamento Evolution v2 (confirmar contra a documentação da versão instalada e registrar os payloads reais nas fixtures):
- `connect`: `POST /instance/create` (header `apikey: EVOLUTION_API_KEY`, body `{ instanceName: 'clinic-<clinicId>', qrcode: true, integration: 'WHATSAPP-BAILEYS', webhook: { url, events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'] } }`) → token = `hash`; se a instância já existe, `GET /instance/connect/{instance}` para novo QR.
- `getStatus`: `GET /instance/connectionState/{instance}` → `open` = connected, `connecting` = connecting, demais = disconnected; telefone via `GET /instance/fetchInstances?instanceName=` (`ownerJid`).
- `disconnect`: `DELETE /instance/logout/{instance}`.
- `sendText`: `POST /message/sendText/{instance}` (header `apikey: <token da instância>`, body `{ number, text }`) → `key.id`. HTTP 400 com número inexistente → `PermanentSendError`; rede, 5xx, instância fechada → `TransientSendError`.
- `parseWebhook`: `messages.upsert` → `incoming` só se `!key.fromMe`, `remoteJid` termina com `@s.whatsapp.net` e há texto (`message.conversation` ou `message.extendedTextMessage.text`); `from` = `normalizePhone(remoteJid sem sufixo)`; `connection.update` → `connection`. Qualquer outro caso → `null`.

- [ ] **Step 1: Testes que falham** (com `fetchImpl` falso e fixtures):
  - `sendText` envia `apikey` da instância e o corpo `{ number: '5511987654321', text }`; devolve `providerMessageId`
  - resposta 400 "exists: false" → lança `PermanentSendError`; 500 e `fetch` rejeitado → `TransientSendError`
  - `parseWebhook`: texto normal → `incoming` com `from: '5511987654321'`; JID `551187654321@s.whatsapp.net` → `from: '5511987654321'` (Review Focus 3); `fromMe: true`, `@g.us`, `status@broadcast`, áudio sem texto, corpo inválido → `null` (Review Focus 4); `connection.update` `open` → `{ kind: 'connection', status: 'connected' }`
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(whatsapp): provedor Evolution API`

---

### Task 8: Fila e envio

**Files:**
- Create: `src/lib/messaging/repo.ts`, `src/lib/messaging/sender.ts`, `tests/messaging/sender.test.ts`, `tests/messaging/fakeRepo.ts`

**Interfaces:**
- Consumes: `WhatsAppProvider`, erros (Task 7); `isWithinSendWindow`, `startOfClinicDay` (Task 3)
- Produces:
  ```ts
  export interface QueuedMessage { id: string; phone: string; body: string; attempts: number }
  export interface QueueRepo {
    releaseStuck(clinicId: string, olderThan: Date): Promise<void>
    listDue(clinicId: string, now: Date, limit: number): Promise<QueuedMessage[]>
    lock(id: string): Promise<boolean>                    // queued → sending; false se outro pegou
    markSent(id: string, providerMessageId: string, at: Date): Promise<void>
    markFailed(id: string, error: string): Promise<void>
    requeue(id: string, attempts: number, at: Date, error: string): Promise<void>
    countSentSince(clinicId: string, since: Date): Promise<number>
  }
  export function createSupabaseQueueRepo(admin: SupabaseClient): QueueRepo
  export interface SendDeps { now: () => Date; sleep: (ms: number) => Promise<void>; random: () => number; deadline: Date }
  export function processQueue(args: { clinicId: string; cfg: MessagingConfig; instance: string; token: string
    connected: boolean; repo: QueueRepo; provider: WhatsAppProvider; deps: SendDeps }):
    Promise<{ sent: number; failed: number; requeued: number; skippedReason?: 'disconnected' | 'outside_window' | 'daily_limit' }>
  ```
- `countSentSince` conta `direction='out'` e `status='sent'`. `lock` = `UPDATE ... SET status='sending' WHERE id=$1 AND status='queued' RETURNING id`.

- [ ] **Step 1: Testes que falham** (repo em memória + provedor falso, `sleep` instantâneo registrando os ms):
  - envia todos os itens vencidos e marca `sent`; esperas entre envios entre 3000 e 8000 ms
  - `connected: false` → nada enviado, `skippedReason: 'disconnected'`
  - fora da janela → nada enviado, `'outside_window'`
  - `daily_limit: 2` com 1 já enviado hoje → envia 1, `'daily_limit'`
  - erro temporário: `attempts` 0 → `requeue` com `attempts: 1` e `at = now + 5 min`; `attempts` 2 → `markFailed`
  - erro permanente → `markFailed`, sem nova tentativa
  - dois `processQueue` concorrentes sobre o mesmo repo → cada mensagem enviada exatamente uma vez
  - `deadline` atingido no meio → para, restante continua `queued`
  - `releaseStuck` é chamado com `now − 10 min`
- [ ] **Step 2:** FAIL. **Step 3:** implementar `processQueue` e `createSupabaseQueueRepo`. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(mensagens): processamento da fila com proteções`

---

### Task 9: Ciclo do agendador + rota de cron

**Files:**
- Create: `src/lib/messaging/cycle.ts`, `src/app/api/cron/messages/route.ts`

**Interfaces:**
- Consumes: `planMessages`, `staleReason` (Task 4), `processQueue`, `createSupabaseQueueRepo` (Task 8), `getProvider` (Task 7), `createAdminClient` (Task 6)
- Produces: `runCycle(admin: SupabaseClient, provider: WhatsAppProvider, now: Date, deadline: Date): Promise<Record<string, { planned: number; cancelled: number; sent: number; failed: number; skippedReason?: string }>>`

- [ ] **Step 1: Implementar `runCycle`** — para cada linha de `whatsapp_connections` com `status='connected'`: carrega `clinics` (nome, `messaging_config`), `message_settings`, pacientes, consultas `(now, now+48h]` com nome do profissional, última concluída por paciente, pacientes com futura, pagamentos `pending|overdue`; `planMessages` → `upsert` em `messages` com `onConflict: 'clinic_id,dedupe_key', ignoreDuplicates: true`, `direction: 'out'`, `status: 'queued'`; limpeza: para cada `queued` com `dedupe_key`, `staleReason` ≠ `null` → `status: 'cancelled'`, `error: <motivo>`; depois `processQueue`. Erro numa clínica é registrado no resultado e não interrompe as outras.
- [ ] **Step 2: Rota** `POST` — `Authorization` ≠ `Bearer ${CRON_SECRET}` → 401; `export const maxDuration = 60`; `deadline = now + 50 s`; responde JSON com o resultado.
- [ ] **Step 3: Verificar** — `curl -X POST localhost:3001/api/cron/messages` sem header → 401. Com header e nenhuma clínica conectada → `200 {}`. Testes anteriores continuam passando (`npm test`). `npx tsc --noEmit` sem erros.
- [ ] **Step 4: Commit** `feat(mensagens): ciclo do agendador e rota de cron`

---

### Task 10: Webhook e respostas do paciente

**Files:**
- Create: `src/lib/messaging/incoming.ts`, `src/app/api/webhooks/evolution/route.ts`, `tests/messaging/incoming.test.ts`

**Interfaces:**
- Consumes: `parseReply`, `pickConfirmationTarget` (Task 5), `WebhookEvent` (Task 7), `buildContext`/`formatDataCurta`/`formatHora` (Task 2)
- Produces:
  ```ts
  export interface IncomingDeps {
    findClinicByInstance(instance: string): Promise<{ clinicId: string; token: string; cfg: MessagingConfig } | null>
    findPatientByPhone(clinicId: string, phone: string): Promise<string | null>
    saveIncoming(row: { clinic_id: string; patient_id: string | null; phone: string; body: string; provider_message_id: string }): Promise<string>
    recentConfirmations(clinicId: string, phone: string, since: Date): Promise<SentConfirmation[]>
    setAppointmentStatus(appointmentId: string, status: 'confirmed' | 'cancelled'): Promise<void>
    setReplyAction(messageId: string, action: 'confirmed' | 'cancelled'): Promise<void>
    sendAutoReply(args: { clinicId: string; phone: string; body: string; appointmentId: string }): Promise<void>
    updateConnection(instance: string, status: ConnectionStatus, phone: string | null): Promise<void>
  }
  export function handleIncoming(event: WebhookEvent, deps: IncomingDeps, now: Date): Promise<'ignored' | 'stored' | 'confirmed' | 'cancelled' | 'connection'>
  ```
- Textos de resposta automática (exatos): confirmar → `Consulta confirmada! Até {data} às {hora}.`; cancelar → `Consulta desmarcada. Em breve entraremos em contato para remarcar.`
- `sendAutoReply` envia na hora (ignora janela), grava `type 'auto_reply'`, respeita `daily_limit` (acima do limite: grava `failed` com `error: 'daily_limit'`).
- `findPatientByPhone` compara `normalizePhone(whatsapp)`/`normalizePhone(phone)` dos pacientes da clínica com o telefone recebido.

- [ ] **Step 1: Testes que falham** (deps falsas):
  - "1" com confirmação válida → `setAppointmentStatus(id, 'confirmed')`, `setReplyAction`, auto_reply com `'Consulta confirmada! Até '`; retorno `'confirmed'`
  - "2" → `'cancelled'` e texto de desmarcação
  - "obrigado" → só `saveIncoming`, retorno `'stored'`
  - "1" sem confirmação válida → `'stored'`, nenhuma alteração
  - instância desconhecida → `'ignored'`
  - evento `connection` → `updateConnection` (e `ever_connected = true` quando `connected`), retorno `'connection'`
  - telefone `551187654321` encontra paciente cadastrado como `(11) 98765-4321` (Review Focus 3)
- [ ] **Step 2:** FAIL. **Step 3:** implementar `handleIncoming` e as deps reais com `createAdminClient`. **Step 4:** PASS.
- [ ] **Step 5: Rota** `POST /api/webhooks/evolution?token=` — token ≠ `EVOLUTION_WEBHOOK_TOKEN` → 401; corpo inválido ou `parseWebhook` → `null` → 200 `{ ignored: true }` (nunca 500 para payload desconhecido, para a Evolution não reenviar em loop).
- [ ] **Step 6: Commit** `feat(mensagens): webhook e confirmação pela resposta do paciente`

---

### Task 11: Conexão por QR Code (rotas + tela de configurações)

**Files:**
- Create: `src/app/api/whatsapp/connect/route.ts`, `src/app/api/whatsapp/status/route.ts`, `src/app/api/whatsapp/disconnect/route.ts`
- Modify: `src/app/(dashboard)/configuracoes/mensagens/page.tsx` (substituir o formulário de chave), `docker-compose.evolution.yml` (novo)

**Interfaces:**
- Consumes: `getCurrentClinic` (Task 6), `getProvider` (Task 7), `createAdminClient`
- Produces (JSON das rotas): `POST /api/whatsapp/connect` → `{ status: ConnectionStatus; qrCode: string | null }`; `GET /api/whatsapp/status` → `{ status: ConnectionStatus; phone: string | null; everConnected: boolean }`; `POST /api/whatsapp/disconnect` → `{ status: 'disconnected' }`. Sem sessão → 401.

- [ ] **Step 1: `docker-compose.evolution.yml`** — Evolution API v2 (imagem oficial `evoapicloud/evolution-api` na versão estável atual) com Postgres e Redis próprios, porta `8080`, `AUTHENTICATION_API_KEY` lido de `.env.evolution` (fora do git; adicionar ao `.gitignore`). Na máquina local o webhook aponta para `http://host.docker.internal:3001`.
- [ ] **Step 2: Rotas** conforme Interfaces; `connect` grava/atualiza `whatsapp_connections` (`status: 'connecting'`).
- [ ] **Step 3: Tela** — estados: *Desconectado* (botão "Conectar WhatsApp"), *Conectando* (QR Code em `<img src="data:image/png;base64,...">`, texto "Abra o WhatsApp no celular da clínica → Aparelhos conectados → Conectar aparelho", polling de `/api/whatsapp/status` a cada 3 s, novo QR a cada 40 s), *Conectado* ("Conectado — (11) 98765-4321", botão "Desconectar" com confirmação). Abaixo, formulário "Horário de envio" (início/fim) e "Limite diário", salvando em `clinics.messaging_config` (início < fim; limite entre 1 e 1000).
- [ ] **Step 4: Verificar manualmente** — `docker compose -f docker-compose.evolution.yml up -d`; na tela, conectar com o celular de teste do usuário; status muda para Conectado; desconectar pelo celular → status muda para Desconectado. `npx tsc --noEmit` e `npm run lint` sem erros novos.
- [ ] **Step 5: Commit** `feat(whatsapp): conexão por QR Code`

---

### Task 12: Central de Mensagens — Automáticas e Histórico

**Files:**
- Create: `src/components/mensagens/TabAutomaticas.tsx`, `src/components/mensagens/TabHistorico.tsx`, `src/app/api/messages/[id]/retry/route.ts`
- Modify: `src/app/(dashboard)/mensagens/page.tsx`

**Interfaces:**
- Consumes: `DEFAULT_TEMPLATES`, `TEMPLATE_VARIABLES`, `renderTemplate`, `findUnknownVariables` (Task 2); tabelas `message_settings` e `messages` (leitura direta via cliente do navegador, protegida por RLS)
- Produces: `POST /api/messages/[id]/retry` → recoloca mensagem `failed` da clínica do usuário como `queued`, `attempts: 0`, `scheduled_for: now`; outra clínica ou status ≠ `failed` → 404.

- [ ] **Step 1: Página** — abas "Automáticas" e "Histórico" (remover aba "Mensagens", cards "Alinhadores Invisíveis" e "Campanha personalizada", e os selos de créditos WhatsApp/SMS).
- [ ] **Step 2: `TabAutomaticas`** — um card por tipo com título e descrição atuais, chave liga/desliga, campo do prazo (horas / meses / dias "1 e 7"), editor do texto com chips das variáveis (clicar insere no cursor), prévia ao vivo com paciente fictício "Maria Silva Santos", consulta amanhã 14:30 com "Dra. Ana Ferreira", valor R$ 150,00. Aviso amarelo listando `findUnknownVariables` (Review Focus 5). Botão salvar desabilitado com texto vazio e mensagem "O texto não pode ficar vazio" (Review Focus 5). Botão "Restaurar texto padrão".
- [ ] **Step 3: `TabHistorico`** — tabela paginada (50 por página, mais recentes primeiro): data/hora, paciente, tipo (rótulos: Confirmação, Lembrete, Retorno, Aniversário, Cobrança, Manual, Resposta automática, Recebida), status com cor (Na fila, Enviando, Enviada, Falhou, Cancelada, Recebida), texto truncado com expandir, `reply_action` como selo ("Confirmou"/"Desmarcou"), `error` em "Falhou". Filtros por tipo e status. Botão "Reenviar" em `failed`.
- [ ] **Step 4: Verificar** — ligar "Confirmação", editar texto, recarregar: persistiu. Digitar `{pacinete}` mostra aviso. Apagar todo o texto desabilita salvar. Histórico mostra mensagens geradas no ciclo. `npx tsc --noEmit`, `npm run lint`.
- [ ] **Step 5: Commit** `feat(mensagens): central de mensagens automáticas e histórico`

---

### Task 13: Ficha do paciente — envio manual e opt-out

**Files:**
- Create: `src/app/api/messages/send/route.ts`, `src/components/mensagens/ModalEnviarWhatsApp.tsx`
- Modify: `src/app/(dashboard)/pacientes/[id]/page.tsx`, `src/components/paciente/ModalEditarPaciente.tsx`

**Interfaces:**
- Consumes: `getCurrentClinic`, `getProvider`, `normalizePhone`, `renderTemplate`/`buildContext`, `countSentSince` via `createSupabaseQueueRepo`
- Produces: `POST /api/messages/send { patient_id: string; body: string }` → `200 { id }`; erros com `{ error }` e status: 401 sem sessão; 404 paciente de outra clínica; 422 `"Paciente sem WhatsApp válido"`, `"Paciente optou por não receber WhatsApp"`, `"Texto vazio"`; 409 `"WhatsApp da clínica desconectado"`; 429 `"Limite diário de mensagens atingido"`; 502 falha do provedor (grava `failed`).

- [ ] **Step 1: Rota** conforme Interfaces; ignora janela de horário; grava `type: 'manual'`.
- [ ] **Step 2: Ficha** — botão "Enviar WhatsApp" (ícone verde) abre o modal: seletor "Texto livre" ou um dos 5 modelos (renderizado com os dados do paciente, editável), contador de caracteres, botão Enviar; mostra o erro da rota quando houver. Se o paciente não tem telefone válido, botão desabilitado com dica "Sem WhatsApp válido".
- [ ] **Step 3: Cadastro** — caixa "Não enviar WhatsApp" em `ModalEditarPaciente`, gravando `whatsapp_opt_out`.
- [ ] **Step 4: Verificar** — com WhatsApp conectado, enviar para um paciente com o seu número: chega no celular e aparece no Histórico como Manual; marcar opt-out e tentar de novo: erro 422 exibido. `npx tsc --noEmit`, `npm run lint`.
- [ ] **Step 5: Commit** `feat(mensagens): envio manual e opção de não receber`

---

### Task 14: Agenda e aviso de desconexão

**Files:**
- Create: `src/components/mensagens/WhatsAppBanner.tsx`
- Modify: `src/app/(dashboard)/layout.tsx`, `src/components/agenda/CalendarioAgenda.tsx` e/ou `src/components/agenda/PopoverConsulta.tsx`, `src/app/(dashboard)/agenda/page.tsx`

**Interfaces:**
- Consumes: `GET /api/whatsapp/status` (Task 11); `messages` (RLS) filtrando `appointment_id` das consultas visíveis

- [ ] **Step 1: Banner** — no layout do dashboard, consulta `/api/whatsapp/status` ao carregar e a cada 2 min; se `everConnected && status !== 'connected'`, faixa vermelha "WhatsApp desconectado — as mensagens automáticas estão pausadas." com link "Reconectar" para `/configuracoes/mensagens`.
- [ ] **Step 2: Agenda** — para as consultas carregadas, buscar `messages` `type='confirmation'` (`status='sent'`) e `incoming` com `reply_action`. Na consulta: ícone de check simples "Confirmação enviada", check duplo verde "Confirmada pelo WhatsApp"; no popover, a mesma informação em texto. Consultas desmarcadas pelo WhatsApp nas últimas 24 h: aviso no topo da agenda "N paciente(s) desmarcaram pelo WhatsApp" listando nome e horário, com link para a consulta.
- [ ] **Step 3: Verificar** — com a Evolution parada, banner aparece; com consulta confirmada por "1", ícone duplo aparece. `npx tsc --noEmit`, `npm run lint`.
- [ ] **Step 4: Commit** `feat(mensagens): status de confirmação na agenda e aviso de desconexão`

---

### Task 15: Documentação e teste ponta a ponta

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README** — seção "WhatsApp automático": subir a Evolution local (`docker compose -f docker-compose.evolution.yml up -d`), variáveis novas, aplicar `supabase/2026-11-02-whatsapp-automatico.sql`, ativar o `cron.schedule` em produção (com URL e segredo), como conectar pelo QR. Acrescentar `npm test` à tabela de comandos.
- [ ] **Step 2: Ponta a ponta manual** (com o usuário lendo o QR):
  1. Conectar o WhatsApp de teste.
  2. Cadastrar um paciente com o número do usuário e uma consulta para daqui a ~20 h; ligar Confirmação.
  3. `curl -X POST -H "Authorization: Bearer $CRON_SECRET" localhost:3001/api/cron/messages` → mensagem chega no celular; Histórico mostra Enviada.
  4. Responder "1" → consulta fica Confirmada na agenda, resposta automática chega, ícone duplo aparece.
  5. Nova consulta; responder "2" → consulta Cancelada, aviso na agenda.
  6. Remarcar uma consulta após a confirmação e responder "1" → consulta **não** muda (Review Focus 1).
  7. Rodar o ciclo duas vezes seguidas → nenhuma mensagem duplicada.
- [ ] **Step 3:** `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build` — todos sem erros.
- [ ] **Step 4: Commit** `docs: WhatsApp automático no README`
