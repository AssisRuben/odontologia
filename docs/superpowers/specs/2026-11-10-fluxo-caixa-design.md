# Fluxo de caixa e despesas recorrentes (Financeiro)

Data: 2026-11-10. Branch: `feat/fluxo-caixa`. Fora do roteiro 0–9. Pedido do usuário depois de verificar que a aba "Financeiro > Fluxo de caixa" era só um placeholder ("Em desenvolvimento..."). A aba "Boletos" fica para outra etapa.

## Objetivo

Mostrar quando o dinheiro da clínica entra e sai e como fica o saldo, mês a mês e dia a dia: 2 meses para trás (realizado) e 6 para a frente (previsto). Assim a clínica vê um aperto de caixa antes que ele aconteça.

Hoje o Painel mostra o resumo de um mês por vez, pelo vencimento, sem saldo acumulado. O Livro-caixa só registra o que já foi pago ou recebido.

Para a previsão das saídas ser realista, as despesas passam a poder se repetir todo mês (aluguel, salários, contas).

Critérios de sucesso:
- com um saldo informado, a aba mostra o saldo de hoje, o saldo previsto no 6º mês e o menor saldo previsto, com a data;
- os meses futuros já trazem as despesas fixas, sem ninguém precisar digitá-las de novo;
- as cobranças em atraso aparecem em destaque, sem entrar no saldo;
- ao clicar num mês, aparece o dia a dia daquele mês, com o saldo de cada dia.

## Decisões do usuário

| Tema | Decisão |
|---|---|
| Saldo inicial | Informado pelo usuário: valor e data. Fica um histórico e vale o mais recente. |
| Saídas futuras | Criar despesas recorrentes, que geram despesas "a pagar" reais em Despesas. |
| Horizonte | 2 meses passados e 6 futuros, em gráfico e tabela, com o dia a dia de um mês ao clicar nele. |
| Cobranças em atraso | Ficam fora do saldo e aparecem numa linha "Em atraso", com o total. |
| Abordagem | O fluxo é calculado na hora a partir de pagamentos e despesas. Não existe tabela de fluxo. |

Decisões tomadas no desenho:
- **Pagamento recebido** entra pelo valor líquido (`net_amount`) quando existir; senão, pelo `amount`.
- **Despesa vencida e não paga** conta como saída de hoje (visão conservadora).
- **Painel:** não muda.

## Fora do escopo

- a aba "Boletos" ou "A receber", que terá etapa própria;
- comissões futuras ainda não pagas (só entram quando viram despesa);
- previsão de receita de pacientes novos;
- conciliação com o extrato bancário;
- receitas recorrentes;
- vários bancos ou contas;
- exportação.

## Dados — `supabase/2026-11-10-fluxo-caixa.sql`

A migração pode ser rodada mais de uma vez. Ela é acrescentada ao fim de `supabase/schema.sql`.

### `cash_balances`
- `id`, `clinic_id` (FK clinics, cascade), `balance_date DATE NOT NULL`, `amount NUMERIC(12,2) NOT NULL` (pode ser negativo), `created_by UUID`, `created_at`.
- Índice em `(clinic_id, balance_date DESC, created_at DESC)`.
- RLS `clinic_member`, como `inventory_lots`.
- O saldo que vale é o de `balance_date` mais recente. Em caso de empate, vale o de `created_at` mais recente.

### `expense_recurrences`
- `id`, `clinic_id`, `description TEXT NOT NULL`, `amount NUMERIC(10,2) NOT NULL CHECK (amount > 0)`, `category`, `deduction_group`, `payment_method` (os mesmos CHECKs de `expenses`).
- `day_of_month INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31)`.
- `start_month DATE NOT NULL` e `end_month DATE`, sempre no dia 1 do mês, com `CHECK (end_month IS NULL OR end_month >= start_month)`.
- `generated_until DATE`: o dia 1 do último mês já gerado.
- `created_at`, `updated_at`.
- RLS `clinic_member`.

### `expenses`: colunas novas
- `recurrence_id UUID REFERENCES expense_recurrences(id) ON DELETE SET NULL`.
- `recurrence_month DATE`: o dia 1 do mês que essa despesa representa.
- Índice único `(recurrence_id, recurrence_month)`.

### Regra do vencimento
O vencimento de um mês M é `make_date(ano(M), mês(M), least(day_of_month, último dia de M))`. Assim, dia 31 em fevereiro vira 28 ou 29, e dia 31 em abril vira 30.

### Funções (SECURITY DEFINER, `search_path = public`, só `service_role`)

**`generate_recurring_expenses(p_clinic_id UUID) RETURNS INTEGER`**
- Usa o mês atual de São Paulo (`date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)`).
- Percorre cada recorrência da clínica com `FOR UPDATE`.
- Para cada uma, gera os meses M desde `greatest(start_month, coalesce(generated_until + 1 mês, start_month))` até `mes_atual + 5 meses`. Não passa de `end_month`.
- Para cada M, insere a despesa:
  - `description`, `amount`, `category`, `deduction_group`, `payment_method`: copiados da recorrência;
  - `status='pending'`;
  - `due_date`: pela regra do vencimento;
  - `recurrence_id`, `recurrence_month = M`.
- Usa `ON CONFLICT (recurrence_id, recurrence_month) DO NOTHING`.
- No fim, atualiza `generated_until` para o último M gerado.
- Devolve quantas despesas foram criadas.
- Uma despesa apagada não volta, porque a geração só avança a partir de `generated_until`.
- Recorrência criada com início no passado: gera a partir do início. As vencidas ficam a pagar e o usuário marca como pagas.

**`create_expense_recurrence(p_clinic_id UUID, p_data JSONB) RETURNS UUID`**
- Valida os campos. Erros: `VALOR_INVALIDO`, `DIA_INVALIDO`, `PERIODO_INVALIDO`, `DADOS_INVALIDOS`.
- Insere a recorrência e chama a geração.

**`update_expense_recurrence(p_clinic_id UUID, p_id UUID, p_data JSONB, p_from_month DATE) RETURNS INTEGER`** ("esta e as próximas")
- Atualiza a recorrência: descrição, valor, categoria, grupo, forma de pagamento e dia.
- Atualiza também as despesas dessa recorrência com `recurrence_month >= p_from_month` e `status <> 'paid'`: os mesmos campos e o `due_date` recalculado.
- Devolve quantas despesas foram alteradas.
- Erros: `RECORRENCIA_NAO_ENCONTRADA`, mais os de validação.

**`end_expense_recurrence(p_clinic_id UUID, p_id UUID, p_last_month DATE) RETURNS INTEGER`** (encerrar)
- Grava `end_month = p_last_month`, que pode ser o mês anterior ao atual.
- Apaga as despesas da recorrência com `recurrence_month > p_last_month` e `status <> 'paid'`.
- Devolve quantas foram apagadas.
- Erros: `RECORRENCIA_NAO_ENCONTRADA` e `PERIODO_INVALIDO` (quando `p_last_month < start_month`).

**Bloco opcional no fim do arquivo, comentado:** `cron.schedule('expenses-recurring', '0 9 * * *', $$SELECT public.generate_recurring_expenses(id) FROM clinics$$)`, para quem tiver o pg_cron ativo.

## Cálculo — `src/lib/fluxo/`

**`calcular.ts`**: `montarFluxo(entrada) → Fluxo`, uma função pura.

Entrada:
- `hoje` (YYYY-MM-DD, em São Paulo);
- `saldo: { data, valor } | null`;
- `pagamentos: { id, valor, liquido, status, vencimento, pagoEm, paciente, descricao }[]`;
- `despesas: { id, valor, status, vencimento, pagoEm, descricao, recorrente }[]`.

Regras:
- **Movimentos realizados:**
  - pagamento `paid`, na data `pagoEm` (data em São Paulo), pelo `liquido ?? valor`;
  - despesa `paid`, na data `pagoEm`.
- **Movimentos previstos:**
  - pagamento `pending` ou `overdue` com `vencimento >= hoje`, no vencimento;
  - despesa não paga, no `max(vencimento, hoje)`;
  - despesa sem vencimento conta como saída de hoje.
- **Em atraso:** pagamento não pago com `vencimento < hoje`. Fica fora do saldo e entra em `emAtraso { total, quantidade }`.
- Pagamentos `cancelled` e `refunded` são ignorados.
- **Saldo de cada dia:**
  - sem saldo informado, parte de 0 no início da janela;
  - com saldo informado na data S, o saldo no fim do dia S é o valor informado;
  - para dias depois de S, soma os movimentos dia a dia;
  - para dias antes de S, desfaz os movimentos realizados entre o dia e S.
- **Janela:** do dia 1 de `mês(hoje) − 2` até o último dia de `mês(hoje) + 5`. São 8 meses.

Saída:
- `meses[]`: `{ mes, saldoInicial, entradas, saidas, saldoFinal, realizado, previsto }`. O mês é "realizado" se terminou antes de hoje e "previsto" se começa depois de hoje; o mês atual é misto.
- `dias(mes)`: `{ data, movimentos[], saldoFinal }`, só com os dias que têm movimento. Cada movimento traz `{ tipo:'entrada'|'saida', descricao, valor, previsto: boolean }`.
- `saldoHoje`.
- `saldoFinalPrevisto`: o do fim do 6º mês.
- `menorSaldo { valor, data }`, considerando de hoje em diante.
- `emAtraso`.
- `semSaldoInformado: boolean`.

Valores em centavos (inteiros) dentro do cálculo, para não acumular erro de arredondamento.

## API

Todas as rotas usam `withClinic` e `force-dynamic`.

| Rota | Faz |
|---|---|
| `GET /api/financeiro/fluxo` | Chama `generate_recurring_expenses`, busca os dados e devolve `montarFluxo(...)` com `saldoInformado {data, valor} \| null`. |
| `POST /api/financeiro/saldo` | Recebe `{ data, valorCentavos }`. A data não pode ser futura. Responde 201. |
| `POST /api/financeiro/recorrencias` | Cria a recorrência. Responde 201 `{ id }`. |
| `PATCH /api/financeiro/recorrencias/[id]` | Recebe `{ ...campos, aPartirDe: 'YYYY-MM' }` ("esta e as próximas"). |
| `POST /api/financeiro/recorrencias/[id]/encerrar` | Recebe `{ ultimoMes: 'YYYY-MM' }`. |
| `POST /api/financeiro/recorrencias/gerar` | Chamado ao abrir a aba Despesas. Responde `{ criadas }`. |

**Busca de dados do fluxo:**
- pagamentos pagos com `paid_at` desde `min(início da janela, data do saldo)`;
- pagamentos não pagos com `due_date` até o fim da janela, incluindo os vencidos antes da janela;
- despesas: o mesmo critério dos pagamentos.

## Telas

**Aba Fluxo de caixa** (`src/components/financeiro/FluxoCaixa.tsx`). A aba deixa de mostrar o placeholder. De cima para baixo:
1. **Três cartões:**
   - "Saldo hoje";
   - "Saldo previsto em <mês/ano do 6º mês>";
   - "Menor saldo previsto", com "em dd/mm". Fica em vermelho se for negativo, com o aviso "O caixa fica negativo em dd/mm".
2. **Linha do saldo informado:** "Saldo informado: R$ X em dd/mm/aaaa", com o botão **Informar saldo**. O botão abre uma janela com data (padrão hoje, não pode ser futura) e valor (aceita negativo).
   - Sem saldo informado: "Informe o saldo da conta da clínica para o fluxo partir do valor real. Sem ele, o fluxo parte de R$ 0,00."
3. **Gráfico mensal** com os 8 meses:
   - barras de entradas e saídas, mais a linha do saldo final;
   - os meses passados e os futuros com aparência diferente (os futuros em tom mais claro ou tracejado);
   - feito com o padrão de gráficos que o app já usa, se existir; senão, em SVG simples, sem biblioteca nova.
4. **Tabela mensal:**
   - colunas: Mês, Saldo inicial, Entradas, Saídas, Saldo final;
   - a marca "previsto" nos meses futuros;
   - saldo final negativo em vermelho;
   - clicar numa linha abre ou fecha o dia a dia daquele mês.
5. **Linha "Em atraso"**, só quando houver: "R$ X em N cobranças vencidas — não entram no saldo." Tem o link "Ver no Painel", que leva à aba Painel.
6. **Dia a dia:**
   - mostra só os dias com movimento, com data, a lista de movimentos (descrição, valor, "previsto") e o saldo do fim do dia;
   - saldo negativo em vermelho.

**Aba Despesas:**
- **Janela de nova despesa:** caixa "Repete todo mês". Marcada, mostra "Dia do vencimento" (padrão: o dia da data de vencimento informada) e "Até (opcional)", com mês e ano. Salvar chama POST recorrências; o mês de início é o do vencimento informado.
- **Lista:** despesas com `recurrence_id` mostram um ícone de repetição, com o título "Despesa recorrente".
- **Edição de despesa recorrente:** a janela pergunta "Alterar só esta" ou "Esta e as próximas".
  - "Só esta" edita só a despesa e mantém o vínculo com a recorrência.
  - "Esta e as próximas" chama PATCH recorrências, com `aPartirDe` igual ao mês da despesa.
- **Encerrar:** no menu de uma despesa recorrente, a opção "Encerrar recorrência" pergunta "Encerrar após <mês/ano desta despesa>? As próximas ainda não pagas serão apagadas."
- **Ao abrir a aba,** chama POST gerar e recarrega se algo foi criado.

## Testes

- **`tests/fluxo/calcular.test.ts`:**
  - saldo para trás e para frente a partir do informado;
  - sem saldo informado;
  - atrasado fora do saldo e somado em `emAtraso`;
  - despesa vencida conta como saída de hoje;
  - valor líquido;
  - cancelados ignorados;
  - menor saldo e a data dele;
  - virada de mês e de ano;
  - `pagoEm` convertido para a data de São Paulo.
- **Testes de validação, rotas e acesso ao banco** no padrão das fases anteriores.
- **SQL:** verificado ao vivo pelo controlador depois que o usuário rodar a migração:
  - geração de 6 meses;
  - dia 31;
  - geração idempotente;
  - despesa apagada que não volta;
  - "esta e as próximas" sem mexer nas pagas;
  - encerrar.
- **Navegador:** verificado pelo controlador, com os dados de teste apagados no fim:
  - informar o saldo;
  - criar uma recorrência e ver os meses;
  - abrir o dia a dia;
  - ver a linha de atrasados;
  - encerrar a recorrência.

## Pontos de atenção

- As despesas são gravadas direto pelo navegador, com RLS. A recorrência é criada e editada só pelas funções. As despesas geradas continuam editáveis pela tela atual, porque "só esta" é uma edição normal.
- Os pagamentos e despesas lidos no fluxo são sempre filtrados por `clinic_id`.
- Comissões pagas viram despesa (categoria `comissoes`) e por isso já entram como saída realizada.
