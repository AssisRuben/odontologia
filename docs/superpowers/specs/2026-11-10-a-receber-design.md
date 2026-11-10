# A receber (Financeiro): cobranças em aberto

Data: 2026-11-10. Branch: `feat/a-receber`. Fora do roteiro 0–9. A aba "Financeiro > Boletos" era só um placeholder ("Em desenvolvimento...").

## Objetivo

Reunir num só lugar todas as cobranças de pacientes ainda não pagas, de qualquer mês e de qualquer tipo, para facilitar a cobrança dos atrasados. Hoje cada cobrança só aparece no Painel, no mês do vencimento.

Critérios de sucesso:
- a aba "A receber" mostra o total em atraso, o que vence nos próximos 7 dias e o total a receber;
- a lista vem separada em "Em atraso" (com "há N dias"), "Próximos 7 dias" e "Depois";
- cada cobrança tem as mesmas ações do Painel e mostra quando foi o último lembrete enviado pelo WhatsApp;
- um envio manual de "Enviar link pelo WhatsApp" passa a contar como lembrete.

## Decisões do usuário

| Tema | Decisão |
|---|---|
| Escopo | A aba passa a se chamar "A receber" e lista todas as cobranças de pacientes não pagas, de qualquer mês e tipo. Convênio fica de fora. |
| Cobrança | Cada cobrança mostra o último lembrete enviado. As ações continuam sendo feitas uma por uma. |
| Abordagem | Os dados são lidos pelo navegador, como no Painel, e a tela reaproveita o `ListaPagamentos`. A organização fica numa função pura. Não há mudança no banco. |

## Fora do escopo

- envio de lembrete para várias cobranças de uma vez;
- exportação;
- mudanças nos lembretes automáticos;
- cobranças pagas, canceladas ou estornadas;
- convênio (já controlado em Convênios → lotes);
- mudanças no Painel.

## Dados

Nenhuma migração. Tudo é lido com o cliente Supabase do navegador (RLS), como faz o Painel em `src/app/(dashboard)/financeiro/page.tsx`.

**Cobranças em aberto:**
- `payments` com `select('*, patient:patients(name)')`;
- filtros: `.eq('clinic_id', clinicId)`, `.in('status', ['pending','overdue'])`, `payment_method` nulo ou diferente de `'convenio'`;
- leitura paginada em blocos de 1000, ordenados por `id`.

**Notas fiscais dessas cobranças:** `fiscal_invoices` com `.in('payment_id', ids)`, em blocos de no máximo 200 ids por consulta. O `ListaPagamentos` precisa delas.

**Lembretes:**
- `messages` com `select('payment_id, type, sent_at')`;
- filtros: `.eq('clinic_id', clinicId)`, `.in('payment_id', ids)` (em blocos de 200), `.eq('status','sent')`, `.eq('direction','out')` e `.in('type', ['charge','payment_due','manual'])`.
- O tipo vira "automático" para `charge` e `payment_due`, e "manual" para `manual`.

**Envio manual com ligação à cobrança:**
- Em `src/lib/messaging/manual.ts`:
  - `sendManual` aceita `paymentId?: string` na entrada;
  - `ManualRow` ganha o campo `payment_id: string | null`;
  - a função de entrega grava esse campo na mensagem.
- Em `src/lib/payments/notify.ts`, só `sendPaymentLink` passa `paymentId: payment.id`. O envio da nota fiscal não passa, porque não é lembrete de cobrança.
- Os outros usos de `sendManual` continuam gravando `payment_id = null`.

## Regras — `src/lib/receber/agrupar.ts` (função pura)

`agruparReceber(e: { hoje: string; pagamentos: Payment[]; lembretes: { payment_id: string; type: string; sent_at: string }[]; filtro: { busca: string; tipo: TipoReceber } }) → Receber`

**Tipos de cobrança** (`TipoReceber = 'todos'|'boleto'|'link'|'cartao'|'manual'`):

| Tipo | `charge_kind` |
|---|---|
| `boleto` | `carne`, ou `avulsa` com `payment_method = 'boleto'` |
| `link` | `avulsa` com outra forma de pagamento (Pix ou link) |
| `cartao` | `cartao_parcelado` |
| `manual` | `manual` |

**Busca:** pelo nome do paciente, sem diferenciar acentos nem maiúsculas. Busca vazia mostra tudo.

**Grupos** (comparando `due_date` com `hoje` em São Paulo):
- **`atraso`:** `due_date < hoje`. Do mais antigo para o mais novo, com `diasAtraso` calculado.
- **`proximos`:** `hoje <= due_date <= hoje + 7`, em ordem crescente.
- **`depois`:** `due_date > hoje + 7`, ou sem `due_date` (estes no fim), em ordem crescente.

**Totais**, sempre somados pelo `amount`, em centavos (`Math.round(amount*100)`):
- `atraso { totalCentavos, quantidade }`;
- `proximos { … }`;
- `total { … }`, com tudo o que está em aberto.
- Os totais refletem o filtro aplicado.

**Último lembrete:** para cada cobrança, `{ data: 'YYYY-MM-DD' (São Paulo), tipo: 'automatico'|'manual' } | null`, usando o `sent_at` mais recente.

**Saída:** `{ grupos: { atraso: ItemReceber[]; proximos: ItemReceber[]; depois: ItemReceber[] }, totais, vazio: boolean }`, em que `ItemReceber = { pagamento: Payment; diasAtraso: number | null; ultimoLembrete: … | null }`.

## Telas

**Aba renomeada:** em `src/app/(dashboard)/financeiro/page.tsx`, o `Tab` `'boletos'` vira `'receber'`, com o rótulo **"A receber"**. Ela renderiza `<AReceber />`. O placeholder "Em desenvolvimento..." deixa de existir.

**`src/components/financeiro/AReceber.tsx`:**
1. **Três cartões:**
   - "Em atraso": total em vermelho `#EF4444` e "N cobrança(s)";
   - "Vence nos próximos 7 dias";
   - "Total a receber".
2. **Filtros:**
   - campo "Buscar paciente";
   - select "Tipo": Todos, Boleto/carnê, Pix/link, Cartão parcelado, Lançamento manual.
3. **Grupos**, na ordem "Em atraso", "Próximos 7 dias" e "Depois":
   - cada um tem um título com a quantidade e o total;
   - um grupo vazio não aparece;
   - cada grupo usa `<ListaPagamentos payments={…} invoices={…} showPatient onChanged={recarregar} extra={…} />`.
4. **Linha extra de cada cobrança:**
   - "Atrasada há N dia(s)", só no grupo de atraso, em vermelho;
   - e "Último lembrete: dd/mm (automático)", "Último lembrete: dd/mm (manual)" ou "Nenhum lembrete enviado".
5. **Lista vazia:**
   - sem filtro: "Nenhuma cobrança em aberto.";
   - com filtro: "Nenhuma cobrança encontrada com esses filtros."
6. **Estados:** carregando, e erro com o botão "Tentar de novo".

**`ListaPagamentos`:** recebe a prop opcional `extra?: (p: Payment) => React.ReactNode`, mostrada logo abaixo das informações da linha. Sem a prop, nada muda no Painel nem nas outras telas que usam o componente.

## Testes

- **`tests/receber/agrupar.test.ts`:**
  - limites de "hoje": vence hoje entra em próximos, e ontem entra em atraso com 1 dia;
  - limite de 7 dias: hoje + 7 entra em próximos, e hoje + 8 entra em depois;
  - sem vencimento vai para o fim de depois;
  - os quatro tipos e "todos";
  - busca sem acento ("joao" encontra "João");
  - totais em centavos e filtrados;
  - escolha do último lembrete: o mais recente vence, e "automático" ou "manual" conforme o tipo;
  - `sent_at` perto da meia-noite convertido para a data de São Paulo.
- **Mensagem manual:** um teste de `sendManual` mostra que `paymentId` vira `payment_id` na linha entregue. Um teste de `sendPaymentLink` mostra que ele passa o id da cobrança.
- **Navegador:** verificado pelo controlador, com os dados de teste apagados no fim:
  - a aba "A receber";
  - os grupos e os totais;
  - o filtro por tipo e a busca;
  - "Marcar como pago" tira a cobrança da lista.
