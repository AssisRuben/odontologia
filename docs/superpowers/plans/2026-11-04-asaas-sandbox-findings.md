# Resultados da verificação no sandbox do Asaas (2026-11-04)

Roteiro: `scripts/asaas-sandbox-probe.mjs`. Fixtures em `tests/payments/fixtures/` (dados pessoais trocados por fictícios; nenhuma chave gravada). Base `https://api-sandbox.asaas.com/v3`, header `access_token`, `User-Agent` obrigatório.

Os três payloads de webhook (`webhook-payment-received`, `webhook-payment-overdue`, `webhook-invoice-authorized`) NÃO foram capturados de entregas reais (sem túnel público): foram montados com o envelope da documentação oficial (`id`, `event`, `dateCreated`, `account`, `payment` | `invoice`) e o objeto `payment` real do sandbox. O campo `_source` de cada um avisa isso. Os campos do objeto `invoice` são da documentação/OpenAPI, não observados.

## 1. Carnê com `billingType: UNDEFINED`
**Confirma a spec.** `POST /payments` com `installmentCount: 3`, `totalValue: 100` e `UNDEFINED` retorna 200. A resposta é a 1ª parcela (com `installment` = UUID do parcelamento, `installmentNumber: 1`). Valores: 33,33 / 33,33 / 33,34 (a última recebe o resto). Vencimentos mensais (20/11, 20/12, 20/01). `GET /installments/{id}/payments` lista as 3 parcelas, mas **fora de ordem** (veio 3, 2, 1): o adaptador deve ordenar por `installmentNumber`. `fine`/`interest` em `{value}` viram `PERCENTAGE`. Cada parcela tem seu próprio `invoiceUrl` e `bankSlipUrl`.
- **Divergência relacionada (ver item 4): não dá para mudar o vencimento de uma parcela isolada de carnê `UNDEFINED`.**

Valor mínimo: **confirma R$ 5,00.** Cobrança avulsa ou total de parcelamento `UNDEFINED` abaixo disso: 400 `invalid_value` ("O valor mínimo para cobranças com a forma de pagamento Pergunte ao Cliente é R$ 5,00"). Parcela abaixo de R$ 5,00: 400 `invalid_installmentValue` ("O valor mínimo por parcela é R$ 5,00"). R$ 5,00 avulsa e 2x R$ 5,00 passam. (`min-value-error.json`)

## 2. Cartão parcelado
**Parcialmente confirmado.** `billingType: CREDIT_CARD`, `installmentCount: 3`, `totalValue: 90` retorna 200 com a 1ª parcela (R$ 30, `PENDING`, `creditCard: null`, `installment` UUID). Cada parcela tem **seu próprio `invoiceUrl`** (URLs diferentes). Não foi possível verificar via API se pagar na `invoiceUrl` da 1ª parcela cobra o parcelamento inteiro nem a sequência de eventos (exigiria pagar com cartão de teste na página do sandbox). A documentação mostra o fluxo `PAYMENT_CREATED` → `PAYMENT_CONFIRMED` → (32 dias) `PAYMENT_RECEIVED` e não diz se o CONFIRMED vem por parcela. Pendente de teste manual no painel; a máquina de estados deve tratar CONFIRMED e RECEIVED de forma independente por parcela, sem supor ordem.

## 3. Formato do webhook
**Confirma a spec (pela documentação).** Envelope: `{ id: "evt_...", event, dateCreated: "AAAA-MM-DD HH:MM:SS", account: { id, ownerId }, payment | invoice }`. O `id` do evento serve para dedupe. `POST /webhooks` (200) aceita `name`, `url`, `email`, `enabled`, `interrupted`, `apiVersion: 3`, `authToken`, `sendType: SEQUENTIALLY`, `events[]`; a resposta traz `hasAuthToken: true` e não devolve o token. **O `authToken` não pode conter números sequenciais** (400 "O token não pode conter números sequenciais."): o token gerado pelo app deve ser aleatório e evitar sequências como 0123 (validar/regerar). O webhook de teste foi removido (`DELETE /webhooks/{id}` retornou 200).
- Eventos `INVOICE_*` (documentação): `INVOICE_CREATED`, `INVOICE_UPDATED`, `INVOICE_SYNCHRONIZED`, `INVOICE_AUTHORIZED`, `INVOICE_PROCESSING_CANCELLATION`, `INVOICE_CANCELED`, `INVOICE_CANCELLATION_DENIED`, `INVOICE_ERROR`. O sandbox aceitou todos no cadastro.
- Eventos `PAYMENT_*` relevantes: CREATED, UPDATED, CONFIRMED, RECEIVED, OVERDUE, DELETED, REFUNDED, RECEIVED_IN_CASH_UNDONE, CREDIT_CARD_CAPTURE_REFUSED, RESTORED, entre outros.

## 4. receiveInCash, DELETE de parcelamento e PUT de vencimento
- `POST /payments/{id}/receiveInCash` `{ paymentDate, value, notifyCustomer:false }`: **confirma**. 200, `status: RECEIVED_IN_CASH`, `netValue` = valor cheio (sem taxa), `paymentDate` preenchido.
- `DELETE /payments/{id}`: **confirma**. 200 `{deleted:true,id}`. O `GET` seguinte retorna 200 com **`deleted: true` e `status` ainda `PENDING`** (não existe status "DELETED"): a reconciliação deve olhar `deleted`.
- `DELETE /installments/{id}`: **confirma**. 200 `{deleted:true,id}`; as 3 parcelas passam a `deleted: true`.
- `PUT /payments/{id}` `{dueDate}`:
  - cobrança avulsa: 200 (`update-due-date-single.json`), `originalDueDate` preservado. Confirma.
  - parcela de carnê `UNDEFINED`: **diverge.** 400 `invalid_dueDate`: "Não é possível alterar individualmente o vencimento de cobranças de parcelamentos com a forma de pagamento Pergunte ao Cliente." (`update-due-date.json`).
  - parcela de carnê `BOLETO`: 200 (`update-due-date-boleto-installment.json`).

## 5. fiscalInfo e emissão de nota
- `GET /fiscalInfo`: **diverge: retorna 404 com corpo vazio** no sandbox desta conta (também `/fiscalInfo/`). `GET /fiscalInfo/municipalOptions` retorna 400 `invalid_person_type` ("só disponível para pessoa jurídica"; a conta de teste é pessoa física). `GET /invoices` funciona (200, lista vazia).
- `POST /invoices` (com `payment`): 400 `invalid_fiscal_info` ("Você precisa informar suas informações fiscais antes de emitir notas fiscais de serviço"). Não configuramos fiscalInfo, então a emissão não foi exercitada.
- Consequência para o adaptador: `getFiscalStatus()` não pode depender de `GET /fiscalInfo` devolvendo 200; tratar 404 (e/ou o 400 `invalid_fiscal_info` do `POST /invoices`) como "não configurado". O motivo exato do 404 (conta PF sem módulo fiscal vs. rota) não ficou claro; vale confirmar numa conta PJ.

## Erros
- CPF inválido: 400 `{errors:[{code:"invalid_object",description:"O CPF/CNPJ informado é inválido."}]}`.
- Chave errada: 401 `{errors:[{code:"invalid_access_token",description:"A chave de API fornecida é inválida"}]}`.

## Resumo das divergências que pedem decisão
1. **Vencimento de parcela de carnê `UNDEFINED` não pode ser alterado individualmente** (BOLETO pode). Afeta a ação "alterar vencimento" em carnês (só avulsa e BOLETO; ou cancelar e recriar as parcelas em aberto).
2. **`GET /fiscalInfo` dá 404** nesta conta: a verificação de configuração fiscal precisa de outro critério.
3. Pendente de teste manual: cobrança do cartão parcelado pela `invoiceUrl` e eventos por parcela (item 2).
4. Observações menores: lista de parcelas fora de ordem; `authToken` sem sequências numéricas; cobrança excluída continua `PENDING` com `deleted: true`.
