# Comissão dos dentistas — design

Item 8 do roteiro. Data: 2026-11-08. Branch: `feat/comissoes`. Usa o que já está na `main`: profissionais, tratamentos (`completed_at`), recebimentos (`payments`, `net_amount` do Asaas), despesas, convênios 7a/7b (`insurance_guide_items` com `payment_id` e `recovered_payment_id`).

## Objetivo

No fim do mês, a clínica sabe quanto pagar a cada dentista, com extrato que explica cada centavo, fecha o mês e registra o pagamento como despesa no Financeiro (e, por ela, no livro-caixa).

Sucesso: a Dra. Ana tem 40% particular e 30% convênio. Em novembro, os pacientes dela pagaram R$ 1.000 (líquido do Asaas R$ 970) por tratamentos concluídos, a operadora pagou R$ 200 de itens dela e houve R$ 100 de laboratório. A aba Comissões mostra 0,40 × 970 + 0,30 × 200 − 0,40 × 100 = R$ 408,00; o extrato lista cada parte; "Fechar mês" congela; "Marcar como pago" cria a despesa "Comissão — Ana — 11/2026". Um estorno em dezembro de um recebimento de novembro aparece em dezembro como ajuste negativo.

## Decisões tomadas com o usuário

| Tema | Decisão |
|---|---|
| Base | **Sobre o recebido** (no convênio, o que a operadora pagou) |
| Ligação recebimento → dentista | **Automática pelo paciente**: os recebimentos quitam os tratamentos concluídos do mais antigo para o mais novo; convênio usa a ligação exata do item do lote |
| Percentual | **Por dentista**, com % particular e % convênio opcional |
| Descontos | **Taxa da cobrança** (valor líquido do Asaas) e **custo de laboratório** |
| Pagamento | **Fechamento mensal** por dentista; pago vira despesa "Comissões de dentistas" |

## Fora do escopo

Percentual por procedimento; dentista vendo só a própria comissão (não há perfis de acesso hoje); RPA e retenção de impostos; adiantamentos; metas e bônus; ligação manual de recebimento a tratamento.

## Regras do cálculo (`src/lib/comissoes/`)

Todo dinheiro em centavos inteiros; datas em `America/Sao_Paulo`; mês = `YYYY-MM`.

1. **Particular (por paciente).**
   - Recebimentos: `payments` com `status = 'paid'`, `payment_method <> 'convenio'` (ou nulo), data = `fromDbPaidAt(paid_at)`. Valor bruto = `amount`; fator líquido = `net_amount / amount` quando `net_amount` não é nulo e `amount > 0`, senão 1.
   - Tratamentos: `status = 'completed'`, `completed_at` não nulo, `value > 0`, **sem** item ativo em `insurance_guide_items` (`active = true`). Ordem: `completed_at`, depois `created_at`, depois `id`.
   - Recebimentos em ordem de data (depois `created_at`, `id`) quitam os tratamentos na ordem acima até o valor de cada um. Cada pedaço quitado = **parte**: `{ tratamento, recebimento, valor bruto, base = round(bruto × fator), data = max(data do recebimento, completed_at) }`.
   - O que sobra dos recebimentos é crédito do paciente: não gera parte até concluir um tratamento novo (aí a data da parte é a conclusão).
   - O mesmo recebimento pode quitar vários tratamentos; o mesmo tratamento pode ser quitado por vários recebimentos.
2. **Convênio.** Para cada `insurance_guide_items` com `payment_id` de recebimento `paid`: parte `{ origem: 'convenio', base = paid_value, data = paid_at do recebimento }`. Com `recovered_payment_id` de recebimento `paid`: parte `{ origem: 'recurso', base = recovered_value, data = paid_at desse recebimento }`. O dentista é o do tratamento do item (`treatment_id → professional_id`); sem tratamento, o da guia.
3. **Percentual.** `professionals.commission_rate` (particular) e `commission_rate_insurance` (convênio e recurso; nulo = usa o particular). Comissão da parte = `round(base × % / 100)`.
4. **Laboratório.** Despesa `category = 'laboratorio'`, `status = 'paid'`, `professional_id` preenchido, data = `paid_at` (São Paulo): desconto = `round(amount × % particular / 100)`, negativo na comissão.
5. **Fora do cálculo.** Tratamento sem dentista; dentista sem `commission_rate` (aparece na tela como "Sem percentual", sem valores).
6. **Mês e ajustes.**
   - `ganho(até D)` = soma das comissões das partes e descontos com data ≤ D, calculada sobre todo o histórico com os dados de hoje.
   - Para o mês M de um dentista: `do mês` = itens com data em M; `ajuste` = `ganho(até véspera de M)` − soma dos fechamentos do dentista com período < M; `total` = `do mês` + `ajuste`.
   - O ajuste absorve meses anteriores não fechados, recebimentos atrasados, estornos e mudanças de percentual — sem caso especial.

| Arquivo | Responsabilidade |
|---|---|
| `alocacao.ts` | Quitação do mais antigo para o mais novo por paciente → partes particulares |
| `calculo.ts` | Partes de convênio/recurso, percentual, laboratório, resumo do mês por dentista (`do mês`, `ajuste`, `total`, quebras por origem) e extrato |
| `periodo.ts` | Mês de uma data, primeiro/último dia, mês encerrado (último dia < hoje em São Paulo) |
| `validar.ts` | Percentuais (0–100, 2 casas, convênio opcional), corpo das rotas (mês `YYYY-MM`, data, forma de pagamento) |
| `repo.ts` | Leitura com `lerTudo` (paginação) de recebimentos, tratamentos, itens de guia, despesas de laboratório, profissionais e fechamentos |

## Banco (`supabase/2026-11-08-comissoes.sql`, espelhado em `schema.sql`)

Re-executável.

- `professionals`: `commission_rate NUMERIC(5,2) CHECK (0–100)` e `commission_rate_insurance NUMERIC(5,2) CHECK (0–100)`, ambos nulos por padrão.
- `expenses`: categoria nova `'comissoes'` no CHECK (e em `CATEGORIES`: `'Comissões de dentistas'`, grupo `'custeio'`, editável).
- `commission_closings`: `id`, `clinic_id`, `professional_id` (FK `ON DELETE CASCADE`), `period DATE` (dia 1 do mês), `amount NUMERIC(10,2) CHECK (> 0)`, `statement JSONB NOT NULL` (resumo + extrato congelados, com os percentuais usados), `status TEXT CHECK IN ('fechado','pago')`, `closed_at TIMESTAMPTZ`, `paid_at DATE`, `payment_method TEXT` (mesmos valores de `expenses`), `expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL`, `UNIQUE (clinic_id, professional_id, period)`. RLS: leitura para membros da clínica; escrita só pelo servidor.

### Funções (SECURITY DEFINER, `p_clinic_id` primeiro, `pg_advisory_xact_lock` por dentista, REVOKE/GRANT `service_role`)

- `close_commission(p_clinic_id, p_professional_id, p_period DATE, p_amount NUMERIC, p_statement JSONB) RETURNS UUID` — o valor vem do cálculo no servidor. Erros: `PROFISSIONAL_INVALIDO`; `MES_ABERTO` (último dia do período ≥ hoje em São Paulo); `VALOR_INVALIDO` (≤ 0); `FECHAMENTO_EXISTE`; `FECHAMENTO_POSTERIOR` (já existe fechamento do dentista em mês posterior).
- `reopen_commission(p_clinic_id, p_closing_id) RETURNS VOID` — apaga o fechamento. `FECHAMENTO_INVALIDO`; `FECHAMENTO_PAGO`; `FECHAMENTO_POSTERIOR`.
- `pay_commission(p_clinic_id, p_closing_id, p_paid_at DATE, p_method TEXT) RETURNS UUID` — trava o fechamento; exige `'fechado'` (`FECHAMENTO_JA_PAGO`); cria despesa paga (`description` = `'Comissão — {nome} — {mm/aaaa}'`, `category 'comissoes'`, `deduction_group 'custeio'`, `professional_id`, `amount`, `paid_at` ao meio-dia de São Paulo, `status 'paid'`), liga `expense_id`, status `'pago'`. Devolve o id da despesa.
- `undo_commission_payment(p_clinic_id, p_closing_id) RETURNS VOID` — exige `'pago'` (`FECHAMENTO_NAO_PAGO`); apaga a despesa ligada; volta a `'fechado'`, limpa `paid_at`, `payment_method`, `expense_id`.

## Rotas (`withClinic`, `{ error }` em português)

| Rota | Faz |
|---|---|
| `GET /api/comissoes?mes=YYYY-MM` | Uma linha por dentista: percentuais, base particular, base convênio, laboratório, `do mês`, `ajuste`, `total`, situação (`aberto`/`fechado`/`pago`, com dados do fechamento) |
| `GET /api/comissoes/[profissionalId]?mes=` | Extrato: fechado → o congelado; aberto → calculado agora |
| `POST /api/comissoes/fechamentos` | `{ professionalId, mes }` → calcula e chama `close_commission` |
| `DELETE /api/comissoes/fechamentos/[id]` | `reopen_commission` |
| `POST /api/comissoes/fechamentos/[id]/pagamento` | `{ paidAt, paymentMethod }` → `pay_commission` |
| `DELETE /api/comissoes/fechamentos/[id]/pagamento` | `undo_commission_payment` |

Erros SQL → `MES_ABERTO` 409 `'O mês ainda não terminou'`; `VALOR_INVALIDO` 409 `'Não há comissão a fechar neste mês'`; `FECHAMENTO_EXISTE` 409 `'Este mês já foi fechado'`; `FECHAMENTO_POSTERIOR` 409 `'Há um mês posterior fechado; reabra-o antes'`; `FECHAMENTO_PAGO` 409 `'Desfaça o pagamento antes de reabrir'`; `FECHAMENTO_JA_PAGO` 409 `'Comissão já está paga'`; `FECHAMENTO_NAO_PAGO` 409 `'Comissão não está paga'`; `FECHAMENTO_INVALIDO` / `PROFISSIONAL_INVALIDO` 404.

## Telas

- **Configurações → Profissionais:** campos "% comissão particular" e "% comissão convênio (opcional; vazio = igual ao particular)".
- **Financeiro → Comissões** (aba hoje vazia): seletor de mês (padrão: mês anterior); tabela por dentista (particular, convênio, laboratório, ajustes, total, situação) com ações "Ver extrato", "Fechar mês" (só mês encerrado e total > 0), "Marcar como pago" (data, forma), "Desfazer pagamento" e "Reabrir" (com confirmação). Total geral no rodapé. Dentista sem percentual aparece com aviso e link para Configurações.
- **Extrato** (modal, imprimível): partes com data, paciente, tratamento, origem (Particular/Convênio/Recurso), base, %, comissão; descontos de laboratório; linha "Ajustes de meses anteriores"; total. Fechado mostra "Fechado em dd/mm" e usa o congelado.

## Erros tratados

Mês inválido; mês não encerrado; total ≤ 0; fechar duas vezes (trava + UNIQUE); fechar mês anterior a um já fechado; reabrir pago; pagar duas vezes; dentista de outra clínica; percentual fora de 0–100.

## Testes

Unitários: alocação (dois tratamentos de dentistas diferentes, pagamento parcial, adiantamento antes da conclusão, crédito sobrando, recebimento quitando vários tratamentos, tratamento em guia excluído, recebimento de convênio ignorado), fator líquido, convênio e recurso, percentual convênio nulo, laboratório, ajuste (estorno depois do fechamento, mês não fechado), arredondamento. Rotas com `fakeSupabase`. Funções SQL no PGlite (fechar, segunda vez → erro, posterior, pagar → despesa, desfazer, reabrir). Teste manual do usuário no fim.

## Documentação

README, seção nova "Comissões": rodar o script, configurar percentuais e o passo a passo do fechamento.
