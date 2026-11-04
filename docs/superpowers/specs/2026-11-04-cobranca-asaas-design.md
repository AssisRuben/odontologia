# Cobrança integrada (Asaas): Design

**Data:** 2026-11-04
**Status:** aprovado em conversa, aguardando revisão da especificação
**Roteiro:** item 2 da Fase 1, com a parte de NFS-e do item 3. Livro-caixa, Carnê-Leão e Receita Saúde continuam no item 3.

## 1. Objetivo

Hoje o app não cria pagamentos: Financeiro e a aba Pagamentos do paciente só exibem lançamentos (vindos do seed). Este projeto permite à clínica **gerar cobranças** (a partir do orçamento aprovado ou avulsas), **enviar o link de pagamento pelo WhatsApp** que já existe, **dar baixa automática** quando o paciente paga e **emitir NFS-e** (clínicas com CNPJ). Pagamentos fora do Asaas (dinheiro, maquininha própria, convênio) passam a poder ser registrados à mão.

Público-alvo: consultórios pequenos (A) e clínicas médias (B).

**Sucesso significa:**
- A secretária gera um carnê de 10 parcelas a partir de um orçamento aprovado em menos de 1 minuto, sem digitar o valor de novo.
- O pagamento aparece como "pago" no Financeiro sem ação humana (em minutos via webhook; no pior caso, na conferência diária).
- Nenhuma cobrança fica duplicada, "fantasma" no Asaas ou sem correspondência no app.
- Uma clínica nunca vê a chave, os pagamentos ou as notas de outra.

## 2. Decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| Provedor | Asaas, atrás de uma interface `PaymentProvider` | Mesmo parceiro do Simples Dental; sem mensalidade; Pix, boleto, cartão e NFS-e numa integração |
| Modelo de conta | Caminho A: cada clínica usa a própria conta Asaas e cola a chave de API | Simples, rápido, sem responsabilidade regulatória sobre contas de terceiros. Subcontas (caminho B) ficam para depois |
| Fonte de verdade | Tabela `payments` do app; Asaas avisa via webhook; conferência diária corrige divergências | Telas e relatórios não dependem do Asaas estar no ar; pagamentos manuais no mesmo lugar |
| Origem da cobrança | Orçamento aprovado (pré-preenchido) e botão "Nova cobrança" na aba Pagamentos do paciente | Evita redigitar valor; cobre consultas avulsas |
| Parcelamento | Carnê (N cobranças mensais Pix/boleto) e cartão parcelado (um link, paciente parcela no cartão) | Carnê atende quem não tem limite; cartão transfere o risco de calote |
| Avisos ao paciente | Notificações do Asaas desligadas (`notificationDisabled`); só o WhatsApp do app | Sem custo extra, sem mensagens duplicadas, mesmas regras anti-bloqueio |
| NFS-e | Emissão automática opcional (desligada por padrão) + botão "Emitir nota" em todo pagamento recebido | A obrigação de nota vale para qualquer forma de pagamento |
| Configuração fiscal | Feita no painel do Asaas; o app só consulta e mostra o estado | O app não guarda certificado digital nem senha |
| Chave de API | Tabela sem acesso pelo navegador (só service role); tela mostra só os 4 últimos caracteres | A chave movimenta o dinheiro da clínica |
| Webhook | Um token por clínica (header `asaas-access-token`), que também identifica a clínica | Mais seguro que o token global usado no WhatsApp |

## 3. Escopo

### Entra
- Conexão com o Asaas em Configurações → Pagamentos (chave, ambiente teste/produção, multa e juros, NFS-e).
- Janela "Nova cobrança": à vista (paciente escolhe Pix, boleto ou cartão), carnê, cartão parcelado, ou registro sem link (dinheiro, cartão na maquininha própria, Pix direto, convênio; pago ou a receber).
- Aprovar orçamento abre a janela pré-preenchida (com "Cobrar depois"); orçamento mostra "Cobrado R$ X de R$ Y".
- Ações por lançamento: copiar link, enviar link pelo WhatsApp, alterar vencimento, marcar como pago (recebido em dinheiro), cancelar (no carnê: só esta ou todas as restantes), emitir/ver/enviar/cancelar nota.
- Webhook do Asaas com baixa automática, estorno, chargeback e alterações feitas no painel.
- Conferência diária (reconciliação) e reprocessamento de avisos que falharam.
- NFS-e: emissão manual e automática, acompanhamento, PDF/XML, envio pelo WhatsApp, cancelamento.
- Mensagens: novo tipo automático "Lembrete de vencimento"; campo `{link}` na "Cobrança"; modelos manuais "Link de pagamento" e "Nota fiscal".

### Fica de fora (nesta versão)
- Subcontas / split / taxa do app sobre pagamentos (caminho B).
- Assinatura recorrente; desconto por pagamento antecipado; maquininha integrada.
- Importar cobranças criadas direto no painel do Asaas.
- "Nova cobrança" na tela do Financeiro sem passar pelo paciente.
- Livro-caixa, Carnê-Leão, Receita Saúde (item 3); relatórios novos.
- Configuração fiscal (inscrição municipal, certificado) dentro do app.

## 4. Arquitetura

```
Tela (Nova cobrança, ações)  ──>  /api/payments/*  ──>  src/lib/payments/*  ──>  PaymentProvider ──> Asaas API v3
                                                             │
Asaas ──webhook──> /api/webhooks/asaas ──> payments/events.ts (máquina de estados) ──> payments, fiscal_invoices
pg_cron (diário) ──> /api/cron/payments ──> payments/reconcile.ts
WhatsApp (já existe) <── messaging/schedule.ts (payment_due, charge com {link})
```

Lógica pura e testável em `src/lib/payments/` (sem Supabase nem HTTP), com dependências injetadas, seguindo o padrão de `src/lib/messaging/`:
- `installments.ts`: divide valor em centavos e calcula vencimentos.
- `status.ts`: máquina de estados (evento ou status do Asaas → novo estado do lançamento).
- `charges.ts`: orquestra a criação (gravar "criando" → Asaas → completar ou desfazer).
- `events.ts`: processa um aviso do webhook (autenticação feita na rota; aqui dedupe + aplicação).
- `reconcile.ts`: compara lançamentos em aberto com o Asaas e corrige.
- `invoices.ts`: agenda, acompanha e cancela NFS-e.
- `repo.ts`: acesso ao Supabase (service role).

Provedor em `src/lib/payments/provider.ts` (interface) e `src/lib/payments/asaas.ts` (implementação).

### Interface do provedor

```ts
interface PaymentProvider {
  verifyKey(): Promise<{ accountName: string }>              // falha → chave inválida
  registerWebhook(url: string, token: string): Promise<{ webhookId: string }>
  removeWebhook(webhookId: string): Promise<void>
  ensureCustomer(c: { externalId: string; name: string; cpf: string; phone?: string; email?: string }): Promise<string>
  createCharge(c: {
    customerId: string; externalReference: string; description: string
    kind: 'avulsa' | 'carne' | 'cartao_parcelado'
    totalCents: number; installmentCount: number; firstDueDate: string
    finePercent: number; interestPercentMonth: number
  }): Promise<ProviderCharge[]>                             // uma por parcela, em ordem
  getCharge(id: string): Promise<ProviderCharge>
  listChargesByReference(externalReference: string): Promise<ProviderCharge[]>
  receiveInCash(id: string, paidAt: string, valueCents: number): Promise<void>
  cancelCharge(id: string): Promise<void>
  cancelInstallment(installmentId: string): Promise<void>   // cancela as parcelas não pagas
  updateDueDate(id: string, dueDate: string): Promise<ProviderCharge>
  getFiscalStatus(): Promise<{ configured: boolean; missing: string[] }>
  scheduleInvoice(i: { chargeId?: string; installmentId?: string; customerId?: string
    valueCents: number; description: string; serviceCode: string; issRate: number
    externalReference: string }): Promise<ProviderInvoice>
  cancelInvoice(id: string): Promise<void>
  getInvoice(id: string): Promise<ProviderInvoice>
}
```

`ProviderCharge` traz: `id`, `installmentId`, `installmentNumber`, `status` (status bruto do Asaas), `valueCents`, `netValueCents`, `dueDate`, `paidAt`, `invoiceUrl`, `externalReference`.

Erros do provedor são classificados como `invalid_key` (401), `validation` (400, com mensagem traduzida), `not_found` (404) e `unavailable` (rede, 5xx, 429).

### Mapeamento para o Asaas (a confirmar na verificação inicial, §9)
- Base: `https://api-sandbox.asaas.com/v3` (teste) ou `https://api.asaas.com/v3` (produção); header `access_token`.
- Cliente: `POST /customers` com `name`, `cpfCnpj`, `mobilePhone`, `email`, `externalReference` = id do paciente e `notificationDisabled: true`.
- À vista: `POST /payments` com `billingType: UNDEFINED`.
- Carnê: `POST /payments` com `installmentCount` e `totalValue`; `billingType: UNDEFINED` se o parcelamento aceitar, senão `BOLETO` (o boleto do Asaas traz QR Code Pix). As parcelas vêm de `GET /installments/{id}/payments`.
- Cartão parcelado: `POST /payments` com `billingType: CREDIT_CARD`, `installmentCount` e `totalValue`; o paciente paga na `invoiceUrl` da 1ª parcela.
- Multa e juros: `fine.value` e `interest.value`.
- Webhook: `POST /webhooks` com `url`, `authToken`, `sendType: SEQUENTIALLY`, `enabled: true` e os eventos `PAYMENT_*` e `INVOICE_*` da §6.3.
- Recebido em dinheiro: `POST /payments/{id}/receiveInCash`. Cancelar: `DELETE /payments/{id}` e `DELETE /installments/{id}`.
- NFS-e: `GET /fiscalInfo`, `POST /invoices` (com `payment`, `installment` ou `customer`), `POST /invoices/{id}/cancel`.

### Variáveis de ambiente
Nenhuma obrigatória nova. Reusa `APP_URL` e `CRON_SECRET`. Opcional: `ASAAS_WEBHOOK_BASE_URL`, endereço público usado no webhook do Asaas, quando difere de `APP_URL` (no teste local, um túnel). O padrão é `APP_URL`.

## 5. Banco de dados

Arquivo novo `supabase/2026-11-04-cobranca-asaas.sql`, que pode ser rodado mais de uma vez, também incorporado ao `schema.sql`.

### `payment_connections` (só service role: RLS ligada, sem policies)
| Coluna | Tipo | Observação |
|---|---|---|
| clinic_id | UUID PK → clinics | uma conexão por clínica |
| provider | TEXT | `'asaas'` |
| environment | TEXT | `'sandbox'` \| `'production'` |
| api_key | TEXT | nunca sai do servidor |
| api_key_last4 | TEXT | exibido na tela |
| account_name | TEXT | |
| webhook_id | TEXT | |
| webhook_token | TEXT UNIQUE | 64 hex aleatórios; identifica a clínica no webhook |
| status | TEXT | `'connected'` \| `'invalid_key'` |
| fine_percent | NUMERIC(5,2) | padrão 2 |
| interest_percent_month | NUMERIC(5,2) | padrão 1 |
| nfse_auto | BOOLEAN | padrão false |
| nfse_description | TEXT | padrão `'Serviços odontológicos: {descricao}'` |
| nfse_service_code | TEXT | padrão `'4.12'` |
| nfse_iss_rate | NUMERIC(5,2) | |
| created_at, updated_at | TIMESTAMPTZ | |

As telas leem e alteram esses dados pela rota `/api/payments/connection`, que nunca devolve `api_key` nem `webhook_token`.

### `payments` (colunas novas)
| Coluna | Tipo | Observação |
|---|---|---|
| budget_id | UUID → budgets ON DELETE SET NULL | orçamento de origem |
| charge_kind | TEXT | `'manual'` (padrão) \| `'avulsa'` \| `'carne'` \| `'cartao_parcelado'` |
| charge_group_id | UUID | agrupa as parcelas; vai como `externalReference` no Asaas |
| installment_number, installment_count | INT | "3 de 10"; nulos em cobrança única |
| provider_charge_id | TEXT, único por clínica | id da cobrança no Asaas |
| provider_installment_id | TEXT | id do parcelamento no Asaas |
| provider_state | TEXT | `'creating'` \| `'active'`; nulo para manual |
| invoice_url | TEXT | link de pagamento |
| net_amount | NUMERIC(10,2) | valor líquido após taxas |
| alert | TEXT | `'chargeback'` \| `'refunded_with_invoice'` \| nulo |
| updated_at | TIMESTAMPTZ | |

`status` ganha `'cancelled'` e `'refunded'`. As telas atuais somam por status, então lançamentos cancelados e estornados ficam naturalmente fora de "a receber" e "recebido".

### `fiscal_invoices` (RLS por clínica, como as demais tabelas)
`id`, `clinic_id`, `payment_id` → payments, `provider_invoice_id` (único por clínica), `status` (`'scheduled'` \| `'authorized'` \| `'error'` \| `'cancelling'` \| `'cancelled'`), `number`, `value`, `description`, `pdf_url`, `xml_url`, `error`, `created_at`, `updated_at`. No cartão parcelado, a nota aponta para a 1ª parcela e leva o valor total.

### `payment_customers` (só service role)
`clinic_id`, `patient_id`, `provider_customer_id`, PK (clinic_id, patient_id).

### `payment_events` (só service role)
`id`, `clinic_id`, `provider_event_id` (único por clínica), `event`, `payload` JSONB, `status` (`'processed'` \| `'failed'` \| `'ignored'`), `error`, `received_at`, `processed_at`. A conferência diária apaga os eventos processados com mais de 90 dias.

### Mensagens
- `messages.type` e `message_settings.type` ganham `'payment_due'`.
- Configuração padrão de `payment_due`: `{ offset_days: [3] }` (dias antes do vencimento), desligada.
- Modelo: "Olá, {paciente}! Sua parcela de {valor} vence em {vencimento}. Pague por aqui: {link}".
- Chave anti-duplicidade: `payment_due:<payment>:<dias>`.
- `payment_due` e `charge` ignoram lançamentos com `provider_state='creating'`. O `payment_due` só vale para lançamentos com `invoice_url`.
- Na hora do envio, a mensagem é descartada se o lançamento estiver `paid`, `cancelled` ou `refunded`. Hoje a `charge` só descarta `paid`, então essa regra passa a valer para os dois tipos.
- O modelo padrão da `charge` ganha `{link}` numa linha própria no final. Um link vazio não quebra o texto.

### Agendamento
Bloco `cron.schedule('payments-reconcile', '0 9 * * *', ...)`, às 06:00 de Brasília, comentado no fim do SQL, como no WhatsApp.

## 6. Fluxos

### 6.1 Conexão (`POST /api/payments/connection`)
1. Valida a chave com `verifyKey`. Se falhar: "Chave inválida para o ambiente escolhido".
2. Gera o `webhook_token` e chama `registerWebhook(<base>/api/webhooks/asaas, token)`.
3. Grava a conexão. Se a gravação falhar, remove o webhook recém-criado.

Trocar a chave repete os passos e remove o webhook antigo. Desconectar remove o webhook (sem interromper se falhar) e apaga a linha. O app avisa: "Cobranças em aberto continuam no Asaas, mas o app deixa de acompanhá-las".

### 6.2 Criar cobrança (`POST /api/payments/charges`)
Entrada: `patientId`, `budgetId?`, `amountCents`, `description`, `kind`, `installmentCount`, `firstDueDate`, `sendWhatsApp`, `cpf?`.
1. Valida: valor > 0; parcelas entre 1 e 12 nos dois tipos (limite conservador; o cartão aceita até 21 em algumas bandeiras); vencimento ≥ hoje no fuso da clínica; CPF válido (o informado é salvo na ficha); conexão `connected`.
2. Calcula as parcelas (`installments.ts`): centavos divididos igualmente, com a diferença na última; vencimentos mensais no mesmo dia, ajustados para o último dia de meses mais curtos. Por exemplo, 31/01 → 28/02 → 31/03.
3. Grava N linhas em `payments` com `provider_state='creating'`, `status='pending'` e um `charge_group_id` novo.
4. `ensureCustomer` (com cache em `payment_customers`) e depois `createCharge` com `externalReference = charge_group_id`.
5. Sucesso: associa cada `ProviderCharge` à linha de mesma parcela (`provider_charge_id`, `invoice_url`, `due_date`, valor) e marca `provider_state='active'`.
6. O Asaas recusou (`validation`/`invalid_key`) ou não respondeu antes de criar (`unavailable` sem resposta): apaga as linhas e devolve o erro. A tela mostra "Nada foi cobrado".
7. Falha depois de o Asaas ter criado (por exemplo, erro ao gravar): as linhas ficam em `creating` e a conferência (§6.4) completa pelo `externalReference`. A tela mostra "Cobrança enviada ao Asaas; a confirmação pode levar alguns minutos".
8. Se `sendWhatsApp`: envia a mensagem "Link de pagamento" da 1ª parcela pelo `sendNow` que já existe (respeita opt-out, horário e limite; fora do horário, a mensagem vai para a fila).

Clique duplo: o botão fica desativado durante a requisição, e a rota recusa um segundo pedido igual (mesmo paciente, valor e descrição) feito nos últimos 30 segundos.

Registro sem link: a tela grava direto em `payments` (`charge_kind='manual'`), pela RLS, como já acontece no restante do app.

### 6.3 Webhook (`POST /api/webhooks/asaas`)
1. Procura a clínica pelo header `asaas-access-token`. Se não achar, responde 401.
2. Insere em `payment_events`. Se já existir (`provider_event_id` repetido), responde 200 e não faz nada.
3. Aplica a máquina de estados (`status.ts`) no lançamento com aquele `provider_charge_id`. Cobrança desconhecida (criada fora do app): `ignored`.
4. Erro ao processar: marca o evento como `failed`, registra o motivo e **responde 200 mesmo assim**, para o Asaas não pausar a fila. A conferência reprocessa.

| Evento | Regra |
|---|---|
| `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED` (na conferência: status `CONFIRMED`, `RECEIVED` ou `RECEIVED_IN_CASH`) | → `paid`, `paid_at` = data do pagamento, `net_amount`; se `nfse_auto`, agenda a nota. No cartão parcelado, só na 1ª parcela do grupo; um 2º evento do mesmo grupo não gera nota de novo |
| `PAYMENT_OVERDUE` | → `overdue`, só se estiver `pending` |
| `PAYMENT_UPDATED` | atualiza `due_date` e valor, só se `pending` ou `overdue` |
| `PAYMENT_DELETED` | → `cancelled`, a menos que esteja `paid` ou `refunded` |
| `PAYMENT_RESTORED` | → `pending` (ou `overdue`, se vencido), só se `cancelled` |
| `PAYMENT_REFUNDED` | → `refunded`; se houver nota emitida, `alert='refunded_with_invoice'` |
| `PAYMENT_RECEIVED_IN_CASH_UNDONE` | → `pending`/`overdue` conforme o vencimento, só se `paid` |
| `PAYMENT_CHARGEBACK_REQUESTED` | `alert='chargeback'` |
| `INVOICE_AUTHORIZED` | nota → `authorized`, com número, PDF e XML |
| `INVOICE_ERROR` | nota → `error`, com o motivo |
| `INVOICE_CANCELED` | nota → `cancelled` |
| `INVOICE_CANCELLATION_DENIED` | nota volta para `authorized`, com o motivo |
| outros | `ignored` |

Princípio: um evento atrasado nunca rebaixa um estado mais avançado. `paid` e `refunded` só mudam pelos eventos explícitos de desfazer.

### 6.4 Conferência diária (`POST /api/cron/payments`, com `CRON_SECRET`)
Para cada clínica com conexão `connected`, em sequência:
1. Lançamentos em `creating` há mais de 10 minutos: `listChargesByReference(charge_group_id)`. Se achar, completa (§6.2, passo 5). Se não achar e a criação tiver mais de 1 hora, apaga as linhas.
2. Lançamentos `pending` e `overdue` com `provider_charge_id`: `getCharge` e aplica o status do Asaas pela mesma máquina de estados.
3. Notas em `scheduled` ou `cancelling` há mais de 1 hora: `getInvoice` e atualiza.
4. Reprocessa os `payment_events` com status `failed`.
5. Apaga os eventos processados com mais de 90 dias.

Uma chave inválida (401) marca a conexão como `invalid_key` e pula para a próxima clínica. Uma falha numa clínica não impede as outras.

### 6.5 Ações por lançamento
- **Alterar vencimento:** só `pending`/`overdue` → `updateDueDate`, depois grava.
- **Marcar como pago:** com Asaas → `receiveInCash` (data e valor), e o webhook ou a resposta marca `paid`. Lançamento manual → grava direto.
- **Cancelar:** com Asaas → `cancelCharge`, ou `cancelInstallment` em "todas as restantes", e marca `cancelled`. Lançamento manual → grava direto. Lançamentos pagos não podem ser cancelados (o estorno é feito no painel do Asaas).
- **Enviar link:** modelo manual "Link de pagamento" pelo `sendNow`.

### 6.6 NFS-e
- **Estado fiscal:** `/api/payments/connection` inclui `getFiscalStatus()`. Com `configured=false`, a tela mostra o que falta e um link para o painel do Asaas.
- **Emitir** (`POST /api/payments/[id]/invoice`): só para lançamentos `paid` sem nota ativa (`scheduled` ou `authorized`). Lançamento manual: `ensureCustomer` (pede o CPF se faltar) e nota ligada ao cliente. Lançamento do Asaas: nota ligada à cobrança, ou ao parcelamento no cartão parcelado. A descrição vem de `nfse_description` com `{descricao}` substituído, editável na janela. Cria a linha `scheduled`.
- **Tentar de novo** (nota em `error`): cria uma nota nova. A antiga fica no histórico.
- **Cancelar** (`authorized`): `cancelInvoice` → `cancelling`. O webhook confirma ou nega.
- **Enviar pelo WhatsApp:** modelo manual "Nota fiscal" com `{link}` = PDF.

## 7. Erros (o que a clínica vê)

| Situação | Mensagem / comportamento |
|---|---|
| Asaas fora do ar ao gerar | "Não foi possível gerar a cobrança agora. Nada foi cobrado do paciente. Tente novamente." |
| Validação do Asaas (CPF, valor etc.) | Mensagem traduzida do Asaas, e nada é gravado |
| Chave inválida/revogada | Faixa no Financeiro e em Configurações: "Reconecte o Asaas". Lançamentos continuam visíveis; botões de cobrança desativados |
| Falha após criação no Asaas | "Cobrança enviada ao Asaas; a confirmação pode levar alguns minutos" (a conferência completa) |
| Estorno com nota emitida | Aviso no lançamento: "Este pagamento foi estornado. Cancele a nota, se necessário." |
| Chargeback | Aviso no lançamento: "Contestação no cartão. Veja o painel do Asaas." |
| Nota com erro | Motivo traduzido + "Tentar novamente" |
| WhatsApp desconectado ou opt-out | Caixa "Enviar link" desmarcada, com o motivo |

## 8. Telas

- **Configurações → Pagamentos** (nova):
  - conexão (chave, ambiente, estado, final da chave, trocar, desconectar);
  - multa e juros;
  - nota fiscal: estado fiscal, descrição padrão, código do serviço, ISS e "emitir automaticamente";
  - aviso para clínica sem CNPJ.
- **Janela "Nova cobrança"**: conforme o desenho aprovado. Resumo "10x de R$ 200,00 · vencimentos 10/12 a 10/09"; CPF pedido só se faltar.
- **TabOrcamentos:** "Aprovar" abre a janela pré-preenchida (ou "Cobrar depois"); cartão do orçamento mostra "Cobrado R$ X de R$ Y" (soma dos lançamentos com `budget_id`, sem cancelados e estornados).
- **Aba Pagamentos do paciente:**
  - botão "Nova cobrança";
  - cada linha mostra "Parcela n/N", situação (a vencer, pago, atrasado, cancelado, estornado), ícone de nota e alerta;
  - menu de ações (§6.5 e §6.6).
- **Financeiro:** mesmas colunas de situação, parcela e nota; faixa de chave inválida.
- **Mensagens → Automáticas:** cartão "Lembrete de vencimento".
- **Envio manual:** modelos "Link de pagamento" e "Nota fiscal".

## 9. Verificação inicial (primeira tarefa do plano)

Antes do código principal, um roteiro no sandbox do Asaas confirma:
1. Se o carnê aceita `billingType: UNDEFINED` (o paciente escolhe Pix ou boleto em cada parcela).
2. Se, no cartão parcelado, a `invoiceUrl` da 1ª parcela cobra o parcelamento inteiro no cartão, e quais eventos chegam para cada parcela (CONFIRMED de todas de uma vez? RECEIVED mês a mês?).
3. O formato real do payload do webhook (id do evento, campos da cobrança e da nota).
4. O comportamento de `receiveInCash`, `DELETE /installments/{id}` e `PUT /payments/{id}` (vencimento).
5. `GET /fiscalInfo` e a emissão de nota no sandbox, além dos nomes exatos dos eventos `INVOICE_*`.

Os resultados viram fixtures dos testes do adaptador. Divergências são levadas ao usuário antes de seguir.

## 10. Testes

- **Unitários (TDD), sem rede:**
  - `installments.ts`: centavos, fim de mês, limites;
  - `status.ts`: todas as linhas da tabela §6.3, incluindo eventos fora de ordem e repetidos;
  - `charges.ts` com provedor falso: sucesso, recusa, queda antes e depois da criação, clique duplo;
  - `events.ts`: dedupe e falha marcando `failed`;
  - `reconcile.ts`: completar `creating`, apagar órfãos, corrigir status, reprocessar e isolar a falha de uma clínica;
  - `invoices.ts`;
  - mensagens: `payment_due` e `{link}`.
- **Adaptador Asaas:** testes com fixtures gravadas no sandbox (§9), cobrindo o mapeamento dos campos e a classificação de erros.
- **Rotas:** webhook (token errado → 401, token certo → 200, evento duplicado) e criação (clínica de outro usuário → 403/404).
- **Migração:** teste no padrão do `tests/supabase/migration.test.ts` (tipos novos de mensagem, status novos; tabelas só-servidor sem policies).
- **Ponta a ponta com o usuário** (sandbox):
  - conectar a conta de teste;
  - gerar à vista, carnê e cartão parcelado;
  - simular pagamento no painel;
  - ver a baixa (via túnel para o webhook, ou conferência disparada à mão);
  - emitir nota de teste;
  - cancelar uma parcela.

## 11. Fora de escopo / próximos passos
- Caminho B (subcontas, split, receita do app sobre transações).
- Assinatura recorrente (ortodontia), desconto por antecipação, maquininha integrada.
- Importar cobranças criadas no painel do Asaas.
- Item 3: livro-caixa, Carnê-Leão e Receita Saúde para dentista pessoa física.
- Relatórios de recebimento líquido e taxas.
