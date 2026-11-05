# WhatsApp automático — Design

**Data:** 2026-11-02
**Status:** aprovado em conversa, aguardando revisão da especificação
**Roteiro:** item 1 da Fase 1 (base para adoção). Base futura para o item 6 (agente de IA no WhatsApp).

## 1. Objetivo

Tornar real a Central de Mensagens (hoje só visual): a clínica conecta o próprio WhatsApp por QR Code e o app envia sozinho confirmações, lembretes, retornos, aniversários e cobranças, além de envio manual. Público-alvo: consultórios pequenos (1–3 cadeiras) e clínicas médias.

**Sucesso significa:**
- Uma clínica conecta o WhatsApp em menos de 2 minutos, sem ajuda técnica.
- Consultas recebem confirmação 24h antes e a resposta "1"/"2" atualiza a agenda sem ação humana.
- Nenhuma mensagem é enviada em duplicidade, fora do horário ou para quem pediu para não receber.

## 2. Decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| Provedor | Evolution API (não oficial, QR Code), atrás de uma interface de provedor | Custo zero por mensagem e conexão simples para o público A; a API oficial da Meta poderá ser adicionada depois como outra implementação |
| Hospedagem | App na Vercel; Evolution API numa VPS (Docker) compartilhada por todas as clínicas | Evolution precisa de servidor sempre ligado |
| Agendamento | Supabase `pg_cron` + `pg_net` chama `/api/cron/messages` a cada 5 min | Lógica fica no código TypeScript do projeto, sem terceiro servidor |
| Desenvolvimento | Evolution em Docker local | — |

## 3. Escopo

### Entra

**Mensagens automáticas** — cada uma liga/desliga e tem texto editável:

| Tipo (`type`) | Quando | Resposta do paciente |
|---|---|---|
| `confirmation` | `offset_hours` (padrão 24) antes de `start_time`, para consultas `scheduled` | "1" → `confirmed`; "2" → `cancelled` + aviso na agenda; outro texto → só histórico |
| `reminder` | `offset_hours` (padrão 2) antes, só consultas `confirmed` | — |
| `recall` | `offset_months` (padrão 6) após a última consulta `completed`, se não há consulta futura não cancelada | — |
| `birthday` | No dia do aniversário, a partir de 9h (horário da clínica) | — |
| `charge` | 1 e 7 dias após `due_date` de pagamento pendente (`offset_days`, padrão `[1, 7]`) | — |

Variáveis de modelo: `{paciente}` (primeiro nome), `{paciente_completo}`, `{data}` (ex.: "terça, 04/11"), `{hora}` ("14:30"), `{profissional}`, `{clinica}`, `{valor}` ("R$ 150,00"), `{vencimento}` ("04/11/2026"). Variável sem valor no contexto vira texto vazio; variável desconhecida permanece como está (e o editor avisa).

**Também entra:**
- Conexão por QR Code em Configurações → Mensagens, com status e desconexão.
- Histórico de envios e respostas, com filtros e "reenviar" para falhas.
- Envio manual na ficha do paciente (texto livre ou modelo).
- Opção "Não enviar WhatsApp" por paciente.
- Proteções: janela de envio (padrão 8h–20h), intervalo aleatório entre envios (3–8 s), limite diário por clínica (padrão 300), máximo 3 tentativas.

### Fica de fora (nesta versão)

- Campanhas em massa (maior risco de bloqueio no modo não oficial).
- Caixa de conversa completa dentro do app.
- SMS e "créditos" (removidos da tela).
- Agente de IA (item 6 do roteiro).
- API oficial da Meta (apenas a interface fica preparada).

## 4. Arquitetura

```
src/lib/whatsapp/
  provider.ts      interface WhatsAppProvider
  evolution.ts     EvolutionProvider implements WhatsAppProvider
  index.ts         getProvider() — escolhe a implementação (hoje sempre Evolution)
src/lib/messaging/
  phone.ts         normalizePhone(raw) → "55DDDNNNNNNNNN" | null
  templates.ts     renderTemplate(template, ctx), DEFAULT_TEMPLATES, TEMPLATE_VARIABLES
  schedule.ts      funções puras: dado "agora" + dados da clínica → lista de mensagens a enfileirar
  window.ts        isWithinSendWindow(now, settings, tz), remainingDailyQuota(...)
  replies.ts       parseReply(text) → 'confirm' | 'cancel' | null; escolha da confirmação alvo
  sender.ts        processQueue(clinic, provider, deps) — trava, envia, registra, re-tenta
  generate.ts      orquestra schedule.ts com consultas ao banco e faz upsert na fila
  cleanup.ts       cancela itens da fila que deixaram de fazer sentido
src/lib/supabase/
  admin.ts         cliente com service role (somente servidor)
src/app/api/
  whatsapp/connect/route.ts     POST — cria/reusa instância, devolve QR (auth)
  whatsapp/status/route.ts      GET  — status da conexão (auth)
  whatsapp/disconnect/route.ts  POST — logout da instância (auth)
  messages/send/route.ts        POST — envio manual (auth)
  messages/[id]/retry/route.ts  POST — reenfileira mensagem com falha (auth)
  cron/messages/route.ts        POST — ciclo gerar → limpar → enviar (header Authorization: Bearer CRON_SECRET)
  webhooks/evolution/route.ts   POST — mensagens recebidas e status de conexão (token na URL)
```

Antes de escrever as rotas, consultar `node_modules/next/dist/docs/` (Next.js 16 tem mudanças incompatíveis — ver `AGENTS.md`).

### Interface do provedor

```ts
interface WhatsAppProvider {
  connect(clinicId: string): Promise<{ instance: string; token: string; qrCode: string | null; status: ConnectionStatus }>
  getStatus(instance: string, token: string): Promise<{ status: ConnectionStatus; phone: string | null }>
  disconnect(instance: string, token: string): Promise<void>
  sendText(instance: string, token: string, to: string, text: string): Promise<{ providerMessageId: string }>
  parseWebhook(body: unknown): WebhookEvent | null
}
type ConnectionStatus = 'disconnected' | 'connecting' | 'connected'
type WebhookEvent =
  | { kind: 'incoming'; instance: string; from: string; text: string; providerMessageId: string; at: Date }
  | { kind: 'connection'; instance: string; status: ConnectionStatus; phone: string | null }
```

Erros de `sendText` são classificados em `PermanentSendError` (número sem WhatsApp, número inválido) e `TransientSendError` (rede, 5xx, instância desconectada).

### Variáveis de ambiente novas

| Variável | Uso |
|---|---|
| `EVOLUTION_API_URL` | URL do servidor Evolution |
| `EVOLUTION_API_KEY` | chave global do servidor Evolution |
| `CRON_SECRET` | protege `/api/cron/messages` |
| `EVOLUTION_WEBHOOK_TOKEN` | protege `/api/webhooks/evolution` |
| `APP_URL` | URL pública do app, usada ao registrar o webhook na instância |

Documentar no `.env.example` e no README.

## 5. Banco de dados

Arquivo novo: `supabase/2026-11-02-whatsapp-automatico.sql`. Também incorporar ao `supabase/schema.sql` para bancos novos.

```sql
-- Conexão: somente servidor (RLS ligado, nenhuma policy para usuários)
CREATE TABLE whatsapp_connections (
  clinic_id   UUID PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
  instance    TEXT NOT NULL UNIQUE,
  token       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected','connecting','connected')),
  phone       TEXT,
  ever_connected BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Configuração por tipo de mensagem (RLS: membros da clínica leem e editam)
CREATE TABLE message_settings (
  clinic_id  UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('confirmation','reminder','recall','birthday','charge')),
  enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  template   TEXT NOT NULL,
  config     JSONB NOT NULL DEFAULT '{}',   -- { offset_hours } | { offset_months } | { offset_days: [1,7] }
  PRIMARY KEY (clinic_id, type)
);

-- Fila + histórico (RLS: membros da clínica leem; escrita só pelo servidor)
CREATE TABLE messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id          UUID REFERENCES patients(id) ON DELETE SET NULL,
  appointment_id      UUID REFERENCES appointments(id) ON DELETE SET NULL,
  payment_id          UUID REFERENCES payments(id) ON DELETE SET NULL,
  type                TEXT NOT NULL CHECK (type IN ('confirmation','reminder','recall','birthday','charge','manual','auto_reply','incoming')),
  direction           TEXT NOT NULL CHECK (direction IN ('out','in')),
  phone               TEXT NOT NULL,
  body                TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('queued','sending','sent','failed','cancelled','received')),
  scheduled_for       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ,          -- depois disso, não enviar (ex.: início da consulta)
  attempts            INT NOT NULL DEFAULT 0,
  sent_at             TIMESTAMPTZ,
  error               TEXT,
  provider_message_id TEXT,
  reply_action        TEXT CHECK (reply_action IN ('confirmed','cancelled')),  -- em mensagens 'incoming'
  dedupe_key          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, dedupe_key)
);
CREATE INDEX messages_queue_idx ON messages (status, scheduled_for) WHERE status = 'queued';
CREATE INDEX messages_phone_idx ON messages (clinic_id, phone, sent_at DESC);

ALTER TABLE patients ADD COLUMN whatsapp_opt_out BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE clinics  ADD COLUMN messaging_config JSONB NOT NULL DEFAULT
  '{"window_start":"08:00","window_end":"20:00","daily_limit":300,"timezone":"America/Sao_Paulo"}';
```

**RLS das tabelas novas.** O vínculo usuário→clínica é `professionals.user_id = auth.uid()` (criado pelo trigger de cadastro). Criar a função `public.user_clinic_ids()` (`SECURITY DEFINER`, `STABLE`) que devolve os `clinic_id` do usuário logado, e as policies:
- `whatsapp_connections`: RLS ligado, sem policies (acesso só via service role no servidor).
- `message_settings`: `SELECT`/`UPDATE` para `authenticated` com `clinic_id IN (SELECT public.user_clinic_ids())`.
- `messages`: `SELECT` para `authenticated` com a mesma condição; escrita só pelo servidor.

> **Pré-existente, fora deste escopo:** as tabelas atuais usam a policy `auth_all USING (true)` — qualquer usuário logado lê dados de todas as clínicas. Precisa ser corrigido (com a mesma `user_clinic_ids()`) antes de qualquer clínica real usar o app. Registrado como item 0 do roteiro.

- Ao criar uma clínica (trigger existente de cadastro) e no script de migração para clínicas existentes: inserir as 5 linhas de `message_settings` com `enabled = false` e os modelos padrão.
- `clinics.whatsapp_key` e `clinics.whatsapp_phone` deixam de ser usados (não são removidos nesta versão).
- `pg_cron` + `pg_net`: o arquivo SQL inclui, comentado, o `cron.schedule` que chama a rota a cada 5 minutos com o `CRON_SECRET`, com instruções para preencher a URL.

### Chaves anti-duplicidade

| Tipo | `dedupe_key` |
|---|---|
| confirmation | `confirmation:<appointment_id>:<start_time ISO>` |
| reminder | `reminder:<appointment_id>:<start_time ISO>` |
| recall | `recall:<patient_id>:<id da última consulta concluída>` |
| birthday | `birthday:<patient_id>:<ano>` |
| charge | `charge:<payment_id>:<offset_days>` |
| manual / auto_reply / incoming | `NULL` |

Remarcar uma consulta muda `start_time`, gerando nova chave; o item antigo é cancelado pela limpeza.

## 6. Fluxos

### 6.1 Conexão

1. `POST /api/whatsapp/connect`: se não há linha em `whatsapp_connections`, cria instância `clinic-<clinic_id>` na Evolution, registra webhook `APP_URL/api/webhooks/evolution?token=EVOLUTION_WEBHOOK_TOKEN` e salva token; devolve QR (base64).
2. Tela faz polling em `/api/whatsapp/status` a cada 3 s enquanto `connecting`.
3. Webhook `connection` atualiza `status`, `phone` e `ever_connected = true` ao conectar.
4. Desconexão (pelo app ou pelo celular) → `status = 'disconnected'`. Fila não é descartada; envio pausa.

### 6.2 Ciclo do agendador (`POST /api/cron/messages`)

Para cada clínica com `status = 'connected'`:
1. **Gerar** (`generate.ts`): para cada tipo habilitado, busca candidatos e faz `INSERT ... ON CONFLICT (clinic_id, dedupe_key) DO NOTHING`. Pacientes com `whatsapp_opt_out` ou sem telefone válido (`normalizePhone` → `null`) são ignorados. Telefone: `whatsapp` do paciente, senão `phone`.
   - confirmation: consultas `scheduled` com `start_time` em `(agora, agora + offset_hours]`; `expires_at = start_time`.
   - reminder: consultas `confirmed` com `start_time` em `(agora, agora + offset_hours]`; `expires_at = start_time`.
   - recall: pacientes cuja última consulta `completed` tem `start_time <= agora - offset_months`, sem consulta futura não cancelada, e sem recall para essa mesma consulta; `scheduled_for` = início da janela do dia.
   - birthday: aniversariantes de hoje no fuso da clínica (29/02 → 28/02 em anos não bissextos); `scheduled_for` = hoje 09:00; `expires_at` = fim da janela de hoje.
   - charge: pagamentos com `status IN ('pending','overdue')`, `due_date` não nulo e `due_date + offset_days = hoje` (no fuso da clínica).
2. **Limpar** (`cleanup.ts`): marca `cancelled` itens `queued` quando: consulta cancelada/`no_show`/remarcada (chave não bate mais), lembrete de consulta não confirmada, pagamento pago, paciente com opt-out, `expires_at < agora`.
3. **Enviar** (`sender.ts`), só se `isWithinSendWindow` e há cota diária:
   - Seleciona itens `queued` com `scheduled_for <= agora`, ordenados por `scheduled_for`.
   - Trava cada item com `UPDATE ... SET status='sending' WHERE id=? AND status='queued'` (se 0 linhas, outro ciclo pegou — pula).
   - Envia; sucesso → `sent`, `sent_at`, `provider_message_id`. `PermanentSendError` → `failed`. `TransientSendError` → `attempts+1`; se `< 3` volta para `queued` com `scheduled_for = agora + 5 min`, senão `failed`.
   - Espera 3–8 s aleatórios entre envios; para ao atingir ~50 s de execução (o restante fica para o próximo ciclo).
   - Itens `sending` há mais de 10 min (ciclo interrompido) voltam para `queued` no início do passo.

### 6.3 Resposta do paciente (`POST /api/webhooks/evolution`)

1. Valida `token`; inválido → 401.
2. `parseWebhook`. Evento `incoming` de mensagem enviada pela própria clínica (fromMe) é ignorado.
3. Grava mensagem `incoming` (`direction='in'`, `status='received'`), associando o paciente pelo telefone normalizado, se houver.
4. `parseReply(text)`: após `trim` e minúsculas, `"1"`, `"sim"`, `"confirmo"` → confirm; `"2"`, `"não"`, `"nao"`, `"cancelar"` → cancel; demais → null.
5. Se confirm/cancel: busca a mensagem `confirmation` `sent` mais recente para aquele telefone na clínica, enviada nas últimas 48h, cuja consulta ainda está `scheduled`/`confirmed` e não começou. Se encontrada:
   - confirm → consulta `confirmed`; enfileira `auto_reply` "Consulta confirmada! Até {data} às {hora}."
   - cancel → consulta `cancelled`; enfileira `auto_reply` "Consulta desmarcada. Em breve entraremos em contato para remarcar."
   - Registra `reply_action` na mensagem recebida.
6. `auto_reply` é enviada no mesmo request (fora da janela de horário, pois é resposta imediata), respeitando o limite diário.

### 6.4 Envio manual

`POST /api/messages/send { patient_id, body }` → valida sessão, que o paciente pertence à clínica do usuário, telefone válido e conexão ativa. Envia na hora, **ignorando a janela de horário** (é uma ação humana), mas **respeitando o opt-out** (retorna erro "Paciente optou por não receber WhatsApp") e o limite diário. Grava como `manual`.

## 7. Erros

| Situação | Comportamento |
|---|---|
| Paciente sem telefone válido | Não entra na fila; ficha exibe "sem WhatsApp válido" |
| Número sem WhatsApp | `failed` com motivo, sem nova tentativa |
| Evolution fora do ar / erro temporário | Até 3 tentativas com 5 min de intervalo, depois `failed` |
| WhatsApp desconectado | Nada é enviado; fila preservada; faixa vermelha no app se `ever_connected` |
| Webhook com token inválido | 401, ignorado |
| Mesmo número em dois pacientes | Resposta vale para a confirmação enviada por último |
| Ciclos simultâneos | Trava por `UPDATE ... WHERE status='queued'` evita duplicidade |
| Cron sem `CRON_SECRET` correto | 401 |

**Normalização de telefone:** remover não dígitos; remover `0` inicial; se 10 ou 11 dígitos, prefixar `55`; se 12 dígitos começando com `55` e o primeiro dígito do número local for 6–9 (celular sem o 9), inserir `9` após o DDD; aceitar apenas 13 dígitos (`55` + DDD + 9 dígitos) — demais formatos → `null`. Telefones fixos não recebem mensagens.

## 8. Telas

| Onde | Mudança |
|---|---|
| Configurações → Mensagens | Substitui o formulário de chave: botão Conectar + QR, status, número conectado, Desconectar; janela de envio e limite diário |
| Central de Mensagens → aba "Automáticas" | 5 cards reais: liga/desliga, prazo, editor de modelo com lista de variáveis e prévia com paciente de exemplo. Remove "Alinhadores", "Campanha personalizada" e créditos SMS/WhatsApp |
| Central de Mensagens → aba "Histórico" | Tabela (data, paciente, tipo, direção, status, texto/resposta), filtros por tipo e status, paginação, "Reenviar" em falhas |
| Central de Mensagens → aba "Mensagens" | Removida nesta versão (envio manual fica na ficha do paciente) |
| Ficha do paciente | Botão "Enviar WhatsApp" (modal: texto livre ou escolher modelo) e opção "Não enviar WhatsApp" no cadastro |
| Agenda | Ícone na consulta: "confirmação enviada" / "confirmada pelo WhatsApp"; destaque para consultas canceladas pelo paciente via WhatsApp nas últimas 24h |
| Layout | Faixa vermelha "WhatsApp desconectado — reconectar" quando `ever_connected` e `status != 'connected'` |

## 9. Testes

Adicionar **Vitest** (`npm test`). Testes unitários das partes puras e do envio com provedor falso:

- `templates`: substituição, variável sem valor, variável desconhecida, datas/horas em pt-BR e fuso de São Paulo.
- `phone`: com/sem 55, com/sem 9, máscara, fixo, lixo.
- `schedule`: consulta a 24h/25h, já iniciada, cancelada, remarcada (nova chave), opt-out, recall com consulta futura, aniversário 29/02, cobrança D+1/D+7, pagamento pago.
- `window`: dentro/fora da janela no fuso da clínica, cota diária.
- `replies`: "1", " 1 ", "Sim", "2", "não", texto qualquer; confirmação com mais de 48h; consulta já iniciada; dois pacientes com mesmo número.
- `sender` (provedor falso + repositório em memória): sem duplicidade com dois processamentos concorrentes, 3 tentativas em erro temporário, falha permanente, nada enviado se desconectado, interrupção por tempo.

**Teste manual ponta a ponta:** Evolution em Docker local, conectar número de teste por QR, criar consulta para daqui a 24h, rodar o ciclo, responder "1" e verificar a agenda; repetir com "2".

## 10. Fora de escopo / próximos passos

- Implementação `MetaCloudProvider` (API oficial) para clínicas maiores e campanhas.
- Agente de IA no WhatsApp (roteiro, item 6) reaproveitando `messages`, webhook e provedor.
- Remoção das colunas antigas `clinics.whatsapp_key` / `whatsapp_phone`.
